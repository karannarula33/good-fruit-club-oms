"use server";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { loadPriceItemRecords } from "@/lib/pricing/load";
import { resolvePriceForProduct } from "@/lib/pricing/resolve";
import { computeBillTotal, computeCustomerBalance, computeNetDue } from "@/lib/billing/compute";
import { buildBillMessage, type BillLineItem } from "@/lib/billing/message";

export type GenerateBillResult =
  | { ok: true; messageText: string; customerPhone: string | null }
  | { ok: false; reason: "unpriced"; unpricedLineCount: number }
  | { ok: false; reason: "error"; error: string };

export async function generateBill(orderId: string): Promise<GenerateBillResult> {
  const profile = await requireRole(["packer", "admin"]);
  const supabase = await createClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, delivery_date, customer_id")
    .eq("id", orderId)
    .single();
  if (orderError || !order) {
    return { ok: false, reason: "error", error: orderError?.message ?? "Order not found." };
  }

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("display_name, phone")
    .eq("id", order.customer_id)
    .single();
  if (customerError || !customer) {
    return { ok: false, reason: "error", error: customerError?.message ?? "Customer not found." };
  }

  // Idempotent: a bill already exists for this order (e.g. a retried
  // call) -- return it as-is rather than ever generating a second one.
  const { data: existingBill } = await supabase
    .from("bills")
    .select("message_text")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existingBill) {
    return { ok: true, messageText: existingBill.message_text ?? "", customerPhone: customer.phone };
  }

  const { data: lineRows, error: linesError } = await supabase
    .from("order_lines")
    .select("id, product_id, actual_qty, locked_price_per_unit, products(name, unit_label)")
    .eq("order_id", orderId)
    .eq("line_status", "packed");
  if (linesError) {
    return { ok: false, reason: "error", error: linesError.message };
  }

  // A line whose locked_price_per_unit is null was never truly "locked" --
  // per CLAUDE.md §3.2 it was flagged and blocked from billing, not priced
  // at zero. It gets one more chance to resolve right now, against
  // whatever's active at billing time (same "record time" pricing already
  // used for packing substitutions in Slice 6) -- this is what lets a
  // pricing gap fixed in /admin/prices actually unblock a Retry here.
  // A line that *did* lock a real price is never touched, matching the
  // "never recomputed" rule for prices that already locked successfully.
  const now = new Date();
  const priceItems = await loadPriceItemRecords(supabase);
  const newlyResolvedByLineId = new Map<string, number>();
  for (const line of lineRows ?? []) {
    if (line.locked_price_per_unit !== null || !line.product_id) continue;
    const resolved = resolvePriceForProduct(priceItems, line.product_id, now);
    if (resolved) {
      newlyResolvedByLineId.set(line.id, resolved.pricePerUnit);
    }
  }
  if (newlyResolvedByLineId.size > 0) {
    for (const [lineId, pricePerUnit] of newlyResolvedByLineId) {
      const { error } = await supabase
        .from("order_lines")
        .update({ locked_price_per_unit: pricePerUnit })
        .eq("id", lineId);
      if (error) {
        return { ok: false, reason: "error", error: error.message };
      }
    }
  }

  const effectivePriceForLine = (line: { id: string; locked_price_per_unit: number | null }) =>
    line.locked_price_per_unit ?? newlyResolvedByLineId.get(line.id) ?? null;

  const billableLines = (lineRows ?? []).map((line) => ({
    actualQty: line.actual_qty as number,
    lockedPricePerUnit: effectivePriceForLine(line),
  }));

  const { total, unpricedLineCount } = computeBillTotal(billableLines);
  if (unpricedLineCount > 0) {
    return { ok: false, reason: "unpriced", unpricedLineCount };
  }

  const { data: ledgerRows, error: ledgerError } = await supabase
    .from("ledger_entries")
    .select("entry_type, amount")
    .eq("customer_id", order.customer_id);
  if (ledgerError) {
    return { ok: false, reason: "error", error: ledgerError.message };
  }
  const prevBalance = computeCustomerBalance(
    (ledgerRows ?? []).map((row) => ({ entryType: row.entry_type, amount: row.amount })),
  );
  const netDue = computeNetDue(total, prevBalance);

  const billLines: BillLineItem[] = (lineRows ?? []).map((line) => {
    const product = line.products as unknown as { name: string; unit_label: string | null } | null;
    const actualQty = line.actual_qty as number;
    const ratePerUnit = effectivePriceForLine(line) as number;
    return {
      productName: product?.name ?? "Item",
      actualQty,
      unitLabel: product?.unit_label ?? null,
      ratePerUnit,
      amount: actualQty * ratePerUnit,
    };
  });

  const messageText = buildBillMessage({
    customerName: customer.display_name,
    deliveryDate: order.delivery_date,
    lines: billLines,
    total,
    prevBalance,
    netDue,
  });

  const { error: billError } = await supabase.from("bills").insert({
    order_id: orderId,
    total,
    prev_balance: prevBalance,
    net_due: netDue,
    message_text: messageText,
    finalized_at: new Date().toISOString(),
    finalized_by: profile.id,
  });
  if (billError) {
    return { ok: false, reason: "error", error: billError.message };
  }

  const { error: debitError } = await supabase.from("ledger_entries").insert({
    customer_id: order.customer_id,
    entry_type: "debit",
    amount: total,
    order_id: orderId,
    entered_by: profile.id,
  });
  if (debitError) {
    return { ok: false, reason: "error", error: debitError.message };
  }

  // No revalidatePath here on purpose -- see the matching note in
  // src/app/actions/packing.ts. The packer needs the "Send bill" button
  // to stay on screen until they explicitly tap "Done".
  return { ok: true, messageText, customerPhone: customer.phone };
}
