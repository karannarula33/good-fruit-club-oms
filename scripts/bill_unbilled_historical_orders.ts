// One-time batch: generates bills + paid ledger entries for every
// is_historical=true order that has no bill yet (676 orders as of
// 2026-09-14, June 2 - Aug 27, ~₹765k). Decision (confirmed with user):
// assume all paid, mode "other" — the sheet's Notes column only carries
// real payment info on ~8% of rows, not enough to reconstruct per-order
// truth, so this is a known simplification, same as the smaller
// sheet/OMS overlap-correction batch before it.
//
// Bills are balance-neutral (debit + matching paid credit), so each
// customer's prev_balance for every order in this run is just their
// current ledger balance queried once up front — paid entries don't move
// it. Customers missing customers.salutation are classified via the same
// LLM classifier the app uses (src/lib/parser/classify-salutation.ts);
// any that come back "unknown" are skipped and reported, not guessed
// (per CLAUDE.md §3.8 / the app's own convention).
//
// Run with: npx tsx --env-file=.env.local scripts/bill_unbilled_historical_orders.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { fetchAllRows } from "../src/lib/supabase/paginate";
import { classifySalutation } from "../src/lib/parser/classify-salutation";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";

const EXECUTE = process.argv.includes("--execute");
const NOTE = "Backfilled: historical order billing, payment mode assumed";

async function main() {
  const supabase = createServiceRoleClient();

  const orders = await fetchAllRows<any>((from, to) =>
    supabase
      .from("orders")
      .select("id, delivery_date, customer_id")
      .eq("is_historical", true)
      .range(from, to),
  );
  const bills = await fetchAllRows<any>((from, to) =>
    supabase.from("bills").select("order_id").range(from, to),
  );
  const billedIds = new Set(bills.map((b: any) => b.order_id));
  const unbilled = orders.filter((o: any) => !billedIds.has(o.id));
  console.log(`Unbilled historical orders: ${unbilled.length}`);
  if (unbilled.length === 0) return;

  const orderIds = unbilled.map((o: any) => o.id);
  const lines: any[] = [];
  const CHUNK = 200;
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("order_lines")
      .select("order_id, product_id, ordered_qty, actual_qty, locked_price_per_unit, line_status")
      .in("order_id", orderIds.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    lines.push(...(data ?? []));
  }
  const linesByOrder = new Map<string, any[]>();
  for (const l of lines) {
    const arr = linesByOrder.get(l.order_id) ?? [];
    arr.push(l);
    linesByOrder.set(l.order_id, arr);
  }

  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, name, unit_label");
  if (productsError) throw new Error(productsError.message);
  const productById = new Map((products ?? []).map((p: any) => [p.id, p]));

  const customerIds = [...new Set(unbilled.map((o: any) => o.customer_id))];
  const { data: customers, error: customersError } = await supabase
    .from("customers")
    .select("id, display_name, salutation")
    .in("id", customerIds);
  if (customersError) throw new Error(customersError.message);
  const customerById = new Map((customers ?? []).map((c: any) => [c.id, c]));

  const ledgerEntries = await fetchAllRows<any>((from, to) =>
    supabase.from("ledger_entries").select("customer_id, entry_type, amount").range(from, to),
  );
  const balanceByCustomer = new Map<string, number>();
  for (const e of ledgerEntries) {
    const cur = balanceByCustomer.get(e.customer_id) ?? 0;
    balanceByCustomer.set(e.customer_id, cur + (e.entry_type === "debit" ? e.amount : -e.amount));
  }

  // Resolve missing salutations up front so we know which orders are
  // billable before printing the plan.
  const missingSalutationCustomers = customerIds.filter((id) => !customerById.get(id)?.salutation);
  console.log(`Customers in this batch missing salutation: ${missingSalutationCustomers.length}`);
  const resolvedSalutation = new Map<string, "Sir" | "Ma'am">();
  const unknownSalutationCustomers: string[] = [];
  for (const id of missingSalutationCustomers) {
    const name = customerById.get(id)?.display_name ?? "";
    const result = await classifySalutation(name);
    if (result === "unknown") {
      unknownSalutationCustomers.push(id);
    } else {
      resolvedSalutation.set(id, result);
    }
  }
  if (unknownSalutationCustomers.length) {
    console.log(`\nSalutation could not be classified for ${unknownSalutationCustomers.length} customers — their orders will be SKIPPED:`);
    for (const id of unknownSalutationCustomers) {
      console.log(`  ${id} — ${customerById.get(id)?.display_name}`);
    }
  }

  function salutationFor(customerId: string): "Sir" | "Ma'am" | null {
    const existing = customerById.get(customerId)?.salutation;
    if (existing === "Sir" || existing === "Ma'am") return existing;
    return resolvedSalutation.get(customerId) ?? null;
  }

  type Plan = {
    orderId: string;
    customerId: string;
    total: number;
    prevBalance: number;
    netDue: number;
    messageText: string;
    skipLedger: boolean;
  };
  const plans: Plan[] = [];
  const skippedUnknownSalutation: string[] = [];
  let zeroTotalCount = 0;

  for (const o of unbilled as any[]) {
    const salutation = salutationFor(o.customer_id);
    if (!salutation) {
      skippedUnknownSalutation.push(o.id);
      continue;
    }
    const ls = (linesByOrder.get(o.id) ?? []).filter((l) => l.line_status !== "unavailable");
    const billLines: BillLineItem[] = [];
    let total = 0;
    for (const l of ls) {
      const qty = l.actual_qty ?? l.ordered_qty ?? 0;
      const rate = l.locked_price_per_unit ?? 0;
      const amount = Math.round(qty * rate * 100) / 100;
      total += amount;
      const product = productById.get(l.product_id);
      billLines.push({
        productName: product?.name ?? "Unknown product",
        actualQty: qty,
        unitLabel: product?.unit_label ?? null,
        ratePerUnit: rate,
        amount,
      });
    }
    total = Math.round(total * 100) / 100;
    const skipLedger = total === 0;
    if (skipLedger) zeroTotalCount++;
    // Zero-total orders (confirmed free replacements/samples/gifts) still
    // get a bill so they're no longer "invisible" in Manage Orders, but no
    // debit/credit — there's nothing to collect.
    const prevBalance = Math.round((balanceByCustomer.get(o.customer_id) ?? 0) * 100) / 100;
    const netDue = skipLedger ? prevBalance : Math.round((prevBalance + total) * 100) / 100;
    const messageText = buildBillMessage({
      salutation,
      deliveryDate: o.delivery_date,
      lines: billLines,
      total,
      prevBalance,
      netDue,
    });
    plans.push({ orderId: o.id, customerId: o.customer_id, total, prevBalance, netDue, messageText, skipLedger });
  }

  const totalRevenue = plans.reduce((s, p) => s + p.total, 0);
  console.log(`\nBillable orders: ${plans.length} (of which ${zeroTotalCount} are ₹0 confirmed-free orders — billed but no ledger entries)`);
  console.log(`Skipped — unknown salutation: ${skippedUnknownSalutation.length}`);
  console.log(`Total revenue to bill: ₹${totalRevenue.toFixed(2)}`);
  console.log(`\nSample bill message:\n${plans[0]?.messageText}\n`);

  if (!EXECUTE) {
    console.log("Dry run only — pass --execute to write.");
    return;
  }

  // Persist newly-resolved salutations first.
  for (const [customerId, salutation] of resolvedSalutation) {
    const { error } = await supabase.from("customers").update({ salutation }).eq("id", customerId);
    if (error) throw new Error(`salutation update failed for ${customerId}: ${error.message}`);
  }

  const nowIso = new Date().toISOString();
  const WRITE_CHUNK = 500;

  const billRows = plans.map((p) => ({
    order_id: p.orderId,
    total: p.total,
    prev_balance: p.prevBalance,
    net_due: p.netDue,
    message_text: p.messageText,
    finalized_at: nowIso,
  }));
  for (let i = 0; i < billRows.length; i += WRITE_CHUNK) {
    const { error } = await supabase.from("bills").insert(billRows.slice(i, i + WRITE_CHUNK));
    if (error) throw new Error(`bills insert failed at chunk ${i}: ${error.message}`);
  }
  console.log(`Inserted ${billRows.length} bills.`);

  const ledgerPlans = plans.filter((p) => !p.skipLedger);

  const debitRows = ledgerPlans.map((p) => ({
    customer_id: p.customerId,
    entry_type: "debit" as const,
    amount: p.total,
    order_id: p.orderId,
  }));
  for (let i = 0; i < debitRows.length; i += WRITE_CHUNK) {
    const { error } = await supabase.from("ledger_entries").insert(debitRows.slice(i, i + WRITE_CHUNK));
    if (error) throw new Error(`debit insert failed at chunk ${i}: ${error.message}`);
  }
  console.log(`Inserted ${debitRows.length} debit entries.`);

  const creditRows = ledgerPlans.map((p) => ({
    id: randomUUID(),
    customer_id: p.customerId,
    entry_type: "credit" as const,
    amount: p.total,
    mode: "other" as const,
    order_id: null,
    note: NOTE,
  }));
  for (let i = 0; i < creditRows.length; i += WRITE_CHUNK) {
    const { error } = await supabase.from("ledger_entries").insert(creditRows.slice(i, i + WRITE_CHUNK));
    if (error) throw new Error(`credit insert failed at chunk ${i}: ${error.message}`);
  }
  console.log(`Inserted ${creditRows.length} credit entries.`);

  const allocRows = ledgerPlans.map((p, i) => ({
    ledger_entry_id: creditRows[i].id,
    order_id: p.orderId,
    amount: p.total,
  }));
  for (let i = 0; i < allocRows.length; i += WRITE_CHUNK) {
    const { error } = await supabase.from("payment_allocations").insert(allocRows.slice(i, i + WRITE_CHUNK));
    if (error) throw new Error(`allocation insert failed at chunk ${i}: ${error.message}`);
  }
  console.log(`Inserted ${allocRows.length} payment allocations.`);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
