// Corrects the ~93 real (is_historical=false) orders that overlap with
// the Master Dashboard sheet (same customer + IST day) -- these were
// deliberately excluded from the historical import (see
// import_historical_orders.ts) because a real OMS order already existed,
// but the owner confirmed the OMS's order-editing features weren't live
// yet during this window, so the sheet's fruit/qty/sell price is the
// correct, final record -- not whatever the OMS currently has.
//
// Buckets (see the plan this implements):
//   A: no bill yet (recorded/packed-without-bill) -> reconcile lines,
//      mark delivered, generate a bill, post a paid ledger credit.
//   B: has a bill, no payment -> reconcile lines, correct the bill total
//      and the debit ledger entry.
//   C: has a bill AND a payment allocated -> report only, never touched.
//   D: cancelled -> report only, never touched.
//
// Line reconciliation is a diff, not delete-then-reinsert: a line whose
// product continues to exist gets its qty/price updated in place
// (preserving id, package_id, and any already-computed
// actual_packaging_cost/actual_delivery_cost/locked_cogs_per_unit); only
// genuinely added/removed products get inserted/deleted.
//
// bills.prev_balance/net_due are point-in-time display snapshots (what
// an already-sent WhatsApp message showed) -- this script fixes
// bills.total and the ledger debit amount (what actually drives current
// balance/reporting), not every historical snapshot across a customer's
// full bill history. Flagged per customer with >1 affected order.
//
// Run with: npm run correct-overlapping-orders -- <path-to-csv> [--execute]
// Defaults to a dry run.

import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { roundLineAmount, roundToCents, computeCustomerBalance, computeNetDue } from "../src/lib/billing/compute";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";
import { classifySalutation } from "../src/lib/parser/classify-salutation";

const NON_PRODUCT_FRUIT_LABELS = new Set(["Special Discount"]);
const GIFT_BOX_PRODUCT_ID = "9d9766d9-7f1a-4a12-8a79-643f1a4f66e7";

const COL = {
  date: 1, num: 2, customer: 3, phone: 4, address: 5, fruit: 6,
  qty: 7, size: 8, sellPrice: 9, cogs: 10, pkgCost: 11, delivery: 12, notes: 15,
} as const;

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function toIso(d: string): string | null {
  const m = d.trim().match(/^(\d{2})-(\w{3})-(\d{2})$/);
  if (!m || !MONTHS[m[2]]) return null;
  return `20${m[3]}-${MONTHS[m[2]]}-${m[1]}`;
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

interface SheetOrder {
  date: string;
  num: string;
  customer: string;
  phone: string | null;
  address: string;
  notes: string;
  lines: { fruit: string; qty: string; size: string; sellPrice: string; cogs: string; pkgCost: string; delivery: string }[];
}

function parseSheet(csvPath: string): SheetOrder[] {
  const raw = readFileSync(csvPath, "utf-8");
  const rows: string[][] = parse(raw, { columns: false, relax_column_count: true, skip_empty_lines: true });
  const headerIndex = rows.findIndex((r) => r[COL.date]?.trim() === "Date" && r[COL.fruit]?.trim() === "Fruit");
  if (headerIndex === -1) throw new Error('Could not find the "Date"/"Fruit" header row in the CSV');
  const data = rows.slice(headerIndex + 1);

  let currentDate = "", currentNum = "", currentCustomer = "", currentPhone = "", currentAddress = "";
  const grouped = new Map<string, SheetOrder>();

  for (const r of data) {
    const rawDate = (r[COL.date] ?? "").trim();
    const rawNum = (r[COL.num] ?? "").trim();
    const rawCustomer = (r[COL.customer] ?? "").trim();
    const rawPhone = (r[COL.phone] ?? "").trim();
    const rawAddress = (r[COL.address] ?? "").trim();
    const fruit = (r[COL.fruit] ?? "").trim();
    const notes = (r[COL.notes] ?? "").trim();

    if (rawDate && toIso(rawDate)) currentDate = rawDate;
    if (rawNum) currentNum = rawNum;
    if (rawCustomer) { currentCustomer = rawCustomer; currentPhone = ""; currentAddress = ""; }
    if (rawPhone && normalizePhone(rawPhone)) currentPhone = rawPhone;
    if (rawAddress) currentAddress = rawAddress;

    if (!fruit) continue;
    if (rawDate && !toIso(rawDate)) continue; // footer/summary block
    if (!currentDate || !currentNum) continue;

    const key = `${currentDate}__${currentNum}`;
    if (!grouped.has(key)) {
      grouped.set(key, { date: currentDate, num: currentNum, customer: currentCustomer, phone: currentPhone || null, address: currentAddress, notes: "", lines: [] });
    }
    const order = grouped.get(key)!;
    if (notes && !order.notes.includes(notes)) order.notes = order.notes ? `${order.notes}; ${notes}` : notes;
    order.lines.push({
      fruit, qty: (r[COL.qty] ?? "").trim(), size: (r[COL.size] ?? "").trim(),
      sellPrice: (r[COL.sellPrice] ?? "").trim(), cogs: (r[COL.cogs] ?? "").trim(),
      pkgCost: (r[COL.pkgCost] ?? "").trim(), delivery: (r[COL.delivery] ?? "").trim(),
    });
  }
  return [...grouped.values()];
}

// Same one-time manual resolution map as import_historical_orders.ts --
// kept in sync by hand since these scripts are deliberately independent.
const CUSTOMER_NAME_OVERRIDES: Record<string, string> = {
  "shirley": "d8bf4046-0363-4174-8786-da1d58d9b49c",
  "anju": "bb8923e5-005d-4545-bb25-91d18e19083f",
  "madhu": "587b0d36-4150-4186-b247-a28098991f31",
  "simran": "2924b1be-f0f9-4eea-a239-b36201132c1b",
  "gundeep": "51d44752-b60d-4c20-bb4c-fac00643ba9d",
  "samander": "101bf0d4-efca-4c50-b3d4-bc721e2cbf79",
  "nc bansal": "7e7320fb-19f6-4f1b-a1e5-f5bd5e9f5ec3",
  "sunita gupta": "35c84dac-304f-45c3-b147-5801c62b57e4",
  "rakesh chopra": "d43116fc-3735-4915-93f9-0abdb55b2fe5",
  "shilpa orhi": "8c8c3c56-d58b-494b-8562-aa35a5eb094d",
  "vikash": "61eba6c5-2aa3-4cd2-aac2-fd2c776590fa",
  "punam": "c9a3c723-5b07-4fb7-86e2-b7b84f581deb",
  "kinshuk / konika kumar": "9e0181b0-cadf-4cab-a970-e8e33f152766",
  "gundeep thakkar": "51d44752-b60d-4c20-bb4c-fac00643ba9d",
  "sanjeev nirvan yadav": "91171d8b-ed9c-4088-a7ac-892cd04e6dc9",
  "meera g": "a092b264-e1b6-4bbb-b139-fc73bc2fde12",
  "siddharth": "439b81a1-134b-4266-8309-6e33bfe93d12",
  "archana": "2e303289-36f9-4882-a259-ac0318189127",
  "archana kakar": "2e303289-36f9-4882-a259-ac0318189127",
  "archana kakkar": "2e303289-36f9-4882-a259-ac0318189127",
  "sunil saxena": "645e8763-28f8-42d7-b72a-5778910ee270",
  "savita mathur": "0a5adf8e-0923-49ab-9ad5-0dfcd1987624",
};

interface SheetLineResolved {
  productId: string;
  productName: string;
  unit: string;
  qty: number;
  pricePerUnit: number;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const [csvPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!csvPath) {
    console.error("Usage: npm run correct-overlapping-orders -- <path-to-csv> [--execute]");
    process.exit(1);
  }
  console.log(`Mode: ${execute ? "EXECUTE (will write)" : "DRY RUN (no writes)"}\n`);

  const sheetOrders = parseSheet(csvPath);
  const supabase = createServiceRoleClient();

  const [{ data: products }, { data: aliases }, { data: customers }] = await Promise.all([
    supabase.from("products").select("id, name"),
    supabase.from("product_aliases").select("alias, product_id"),
    supabase.from("customers").select("id, display_name, phone, salutation"),
  ]);
  const productById = new Map((products ?? []).map((p) => [p.id, p.name]));
  const productByLowerName = new Map((products ?? []).map((p) => [p.name.toLowerCase(), p.id]));
  const productByLowerAlias = new Map((aliases ?? []).map((a) => [a.alias.toLowerCase(), a.product_id]));
  function resolveProduct(fruitRaw: string): string | null {
    const key = fruitRaw.trim().toLowerCase();
    return productByLowerName.get(key) ?? productByLowerAlias.get(key) ?? null;
  }
  const customerByPhone = new Map((customers ?? []).filter((c) => c.phone).map((c) => [normalizePhone(c.phone as string), c]));
  const customerByLowerName = new Map((customers ?? []).map((c) => [c.display_name.toLowerCase(), c]));
  function resolveCustomerId(name: string, phone: string | null): string | null {
    const override = CUSTOMER_NAME_OVERRIDES[name.toLowerCase()];
    if (override) return override;
    const normPhone = phone ? normalizePhone(phone) : null;
    if (normPhone && customerByPhone.has(normPhone)) return customerByPhone.get(normPhone)!.id;
    const byName = customerByLowerName.get(name.toLowerCase());
    if (byName) return byName.id;
    return null;
  }

  // Every real order, with enough to match by customer+day and to know
  // its current state. order_lines fetched separately and joined in JS --
  // the hand-maintained database.types.ts has no declared Relationships,
  // so an embedded orders->order_lines select doesn't typecheck (same
  // pattern manage-orders/page.tsx already uses for this reason).
  const { data: realOrdersRaw } = await supabase
    .from("orders")
    .select("id, placed_at, status, customer_id")
    .eq("is_historical", false);
  function toIstDate(utcIso: string): string {
    return new Date(new Date(utcIso).getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  interface OrderLineRow {
    id: string; product_id: string | null; ordered_qty: number | null; ordered_unit: string | null;
    actual_qty: number | null; locked_price_per_unit: number | null; package_id: string | null;
  }
  interface RealOrder {
    id: string; placed_at: string; status: string; customer_id: string; order_lines: OrderLineRow[];
  }

  const orderIds = (realOrdersRaw ?? []).map((o) => o.id);
  const { data: allLineRows } = orderIds.length
    ? await supabase.from("order_lines").select("id, order_id, product_id, ordered_qty, ordered_unit, actual_qty, locked_price_per_unit, package_id").in("order_id", orderIds)
    : { data: [] as { id: string; order_id: string; product_id: string | null; ordered_qty: number | null; ordered_unit: string | null; actual_qty: number | null; locked_price_per_unit: number | null; package_id: string | null }[] };
  const linesByOrderId = new Map<string, OrderLineRow[]>();
  for (const l of allLineRows ?? []) {
    const list = linesByOrderId.get(l.order_id) ?? [];
    list.push({ id: l.id, product_id: l.product_id, ordered_qty: l.ordered_qty, ordered_unit: l.ordered_unit, actual_qty: l.actual_qty, locked_price_per_unit: l.locked_price_per_unit, package_id: l.package_id });
    linesByOrderId.set(l.order_id, list);
  }
  const realOrders: RealOrder[] = (realOrdersRaw ?? []).map((o) => ({ ...o, order_lines: linesByOrderId.get(o.id) ?? [] }));
  const realOrderByCustomerDate = new Map(realOrders.map((o) => [`${o.customer_id}__${toIstDate(o.placed_at)}`, o]));

  // The historical import's own dedup check only activates from
  // GO_LIVE_CUTOFF_ISO (2026-08-06) onward, but real orders exist from
  // 2026-07-27 -- so a handful of customer+day combos in that Jul27-Aug5
  // gap can have BOTH a historical (sheet-derived) and a real order,
  // double-counting revenue. Found and confirmed via direct inspection
  // (2 pairs, both genuinely the same real-world order). Any such
  // duplicate found here gets deleted once its real-order counterpart is
  // corrected/completed below -- one final record per customer+day.
  const { data: historicalOrdersRaw } = await supabase.from("orders").select("id, placed_at, customer_id").eq("is_historical", true);
  const historicalOrderByCustomerDate = new Map((historicalOrdersRaw ?? []).map((o) => [`${o.customer_id}__${toIstDate(o.placed_at)}`, o.id]));

  const affectedOrderIds = realOrders.map((o) => o.id);
  const [{ data: bills }, { data: allocations }, { data: debits }] = await Promise.all([
    affectedOrderIds.length ? supabase.from("bills").select("id, order_id, total, message_text").in("order_id", affectedOrderIds) : Promise.resolve({ data: [] }),
    affectedOrderIds.length ? supabase.from("payment_allocations").select("order_id, amount").in("order_id", affectedOrderIds) : Promise.resolve({ data: [] }),
    affectedOrderIds.length ? supabase.from("ledger_entries").select("id, order_id, amount").in("order_id", affectedOrderIds).eq("entry_type", "debit") : Promise.resolve({ data: [] }),
  ]);
  const billByOrderId = new Map((bills ?? []).map((b) => [b.order_id, b]));
  const paidOrderIds = new Set((allocations ?? []).map((a) => a.order_id));
  const debitByOrderId = new Map((debits ?? []).map((d) => [d.order_id, d]));

  const bucketA: { order: RealOrder; sheetOrder: SheetOrder; lines: SheetLineResolved[]; duplicateHistoricalOrderId: string | null }[] = [];
  const bucketB: { order: RealOrder; sheetOrder: SheetOrder; lines: SheetLineResolved[]; oldTotal: number; newTotal: number; duplicateHistoricalOrderId: string | null }[] = [];
  const bucketC: { order: RealOrder; sheetOrder: SheetOrder; lines: SheetLineResolved[]; oldTotal: number; newTotal: number; duplicateHistoricalOrderId: string | null }[] = [];
  const bucketReview: { customer: string; date: string; reason: string; oldTotal: number; newTotal: number; duplicateHistoricalOrderId: string | null }[] = [];
  const alreadyCorrect: string[] = [];
  const unresolvedCustomers = new Map<string, number>();
  const unresolvedProducts = new Map<string, number>();

  const affectedCustomerOrderCounts = new Map<string, number>();

  // Merge by RESOLVED customer+day, not raw sheet name+day -- CLAUDE.md
  // §3.9's "same-customer pastes for the same day merge into one order"
  // applies here too, and two sheet rows can resolve to the same customer
  // via phone/override even with different literal names (found live:
  // "Rahul Khosla" (no phone on that row) and "Vikas Khosla" (has the
  // shared phone) both resolve to one customer record and both landed on
  // 12-Aug -- processing them as two separate corrections against the
  // same real order corrupted the first execute attempt with a duplicate
  // bill insert). A product appearing in more than one merged group is
  // summed (qty combined, price recomputed as the blended per-unit rate)
  // rather than kept as parallel lines, since the correction target is a
  // single reconciled order_lines set keyed by product.
  interface MergedSheetOrder { customerId: string; customerName: string; iso: string; lines: SheetLineResolved[] }
  const mergedByKey = new Map<string, MergedSheetOrder>();

  for (const so of sheetOrders) {
    const iso = toIso(so.date);
    if (!iso) continue;
    const customerId = resolveCustomerId(so.customer, so.phone);
    if (!customerId) {
      unresolvedCustomers.set(so.customer, (unresolvedCustomers.get(so.customer) ?? 0) + 1);
      continue;
    }
    if (!realOrderByCustomerDate.has(`${customerId}__${iso}`)) continue; // not one of the "already captured" 93

    const sheetLines: SheetLineResolved[] = [];
    let hadUnresolvedProduct = false;
    for (const l of so.lines) {
      if (NON_PRODUCT_FRUIT_LABELS.has(l.fruit)) continue;
      const qty = parseFloat(l.qty.replace(/,/g, ""));
      const totalPrice = parseFloat(l.sellPrice.replace(/,/g, ""));
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(totalPrice)) continue; // adjustment/refund line, skip
      const productId = resolveProduct(l.fruit);
      if (!productId) { unresolvedProducts.set(l.fruit, (unresolvedProducts.get(l.fruit) ?? 0) + 1); hadUnresolvedProduct = true; continue; }
      sheetLines.push({ productId, productName: productById.get(productId) ?? l.fruit, unit: l.size.trim().toLowerCase(), qty, pricePerUnit: Math.round((totalPrice / qty) * 100) / 100 });
    }
    if (hadUnresolvedProduct || sheetLines.length === 0) continue;

    const key = `${customerId}__${iso}`;
    const existing = mergedByKey.get(key);
    if (!existing) {
      mergedByKey.set(key, { customerId, customerName: so.customer, iso, lines: sheetLines });
    } else {
      for (const sl of sheetLines) {
        const dup = existing.lines.find((l) => l.productId === sl.productId);
        if (dup) {
          const combinedQty = dup.qty + sl.qty;
          const combinedTotal = roundLineAmount(dup.qty, dup.pricePerUnit) + roundLineAmount(sl.qty, sl.pricePerUnit);
          dup.qty = combinedQty;
          dup.pricePerUnit = Math.round((combinedTotal / combinedQty) * 100) / 100;
        } else {
          existing.lines.push(sl);
        }
      }
    }
  }

  for (const merged of mergedByKey.values()) {
    const { customerId, iso, lines: sheetLines } = merged;
    // `date` is kept as the ISO string directly (not the sheet's DD-MMM-YY
    // format) since downstream only needs a delivery-date-ish value for
    // display and for buildBillMessage -- no need to round-trip back
    // through the original sheet format for a merged, possibly
    // multi-source entry.
    const so = { date: iso, customer: merged.customerName } as SheetOrder;
    const real = realOrderByCustomerDate.get(`${customerId}__${iso}`)!;

    affectedCustomerOrderCounts.set(customerId, (affectedCustomerOrderCounts.get(customerId) ?? 0) + 1);

    const currentLines = real.order_lines ?? [];
    // Same product can legitimately appear more than once (see
    // reconcileLines' comment below) -- compare via consume-by-product,
    // not a product-keyed Map, so a stale duplicate line can never hide
    // behind a coincidentally-matching count and get skipped as "already
    // correct".
    const remaining = new Map<string, { actual_qty: number | null; locked_price_per_unit: number | null }[]>();
    for (const cl of currentLines) {
      if (!cl.product_id) continue;
      const list = remaining.get(cl.product_id) ?? [];
      list.push(cl);
      remaining.set(cl.product_id, list);
    }
    const sameSet = currentLines.length === sheetLines.length && sheetLines.every((sl) => {
      const queue = remaining.get(sl.productId);
      const idx = queue?.findIndex((cl) => Math.abs((cl.actual_qty ?? -1) - sl.qty) < 0.005 && Math.abs((cl.locked_price_per_unit ?? -1) - sl.pricePerUnit) < 0.01) ?? -1;
      if (idx === -1 || !queue) return false;
      queue.splice(idx, 1);
      return true;
    });
    if (sameSet) { alreadyCorrect.push(`${so.date} ${so.customer}`); continue; }

    const oldTotal = roundToCents(currentLines.reduce((sum, l) => sum + (l.actual_qty && l.locked_price_per_unit ? roundLineAmount(l.actual_qty, l.locked_price_per_unit) : 0), 0));
    const newTotal = roundToCents(sheetLines.reduce((sum, l) => sum + roundLineAmount(l.qty, l.pricePerUnit), 0));
    const duplicateHistoricalOrderId = historicalOrderByCustomerDate.get(`${customerId}__${iso}`) ?? null;

    if (real.status === "cancelled") {
      bucketReview.push({ customer: so.customer, date: so.date, reason: "cancelled order", oldTotal, newTotal, duplicateHistoricalOrderId });
      continue;
    }
    if (paidOrderIds.has(real.id)) {
      // User-confirmed: correct the bill/lines even though it's paid, but
      // never touch the existing payment_allocations/ledger -- that's real
      // money already collected against the old amount. This deliberately
      // leaves bill.total != amount paid for the user to reconcile
      // manually (collect the difference, refund, or write it off).
      bucketC.push({ order: real, sheetOrder: so, lines: sheetLines, oldTotal, newTotal, duplicateHistoricalOrderId });
      continue;
    }
    if (billByOrderId.has(real.id)) {
      bucketB.push({ order: real, sheetOrder: so, lines: sheetLines, oldTotal, newTotal, duplicateHistoricalOrderId });
    } else {
      bucketA.push({ order: real, sheetOrder: so, lines: sheetLines, duplicateHistoricalOrderId });
    }
  }

  console.log(`Sheet orders matched to a real OMS order: ${bucketA.length + bucketB.length + bucketC.length + bucketReview.length + alreadyCorrect.length}`);
  console.log(`  Already correct, no action: ${alreadyCorrect.length}`);
  console.log(`  Bucket A (no bill -- will complete): ${bucketA.length}`);
  console.log(`  Bucket B (billed, unpaid -- will correct bill): ${bucketB.length}`);
  console.log(`  Bucket C (billed AND paid -- will correct bill/lines only, ledger/payment left untouched): ${bucketC.length}`);
  bucketC.forEach((c) => console.log(`    - ${c.sheetOrder.date} ${c.sheetOrder.customer}: OMS ₹${c.oldTotal} vs sheet ₹${c.newTotal} -- amount already paid won't match new total by ₹${roundToCents(c.newTotal - c.oldTotal)}`));
  console.log(`  Needs manual review (cancelled): ${bucketReview.length}`);
  bucketReview.forEach((r) => console.log(`    - ${r.date} ${r.customer}: ${r.reason} (OMS ₹${r.oldTotal} vs sheet ₹${r.newTotal}, diff ₹${roundToCents(r.newTotal - r.oldTotal)})${r.duplicateHistoricalOrderId ? " [ALSO has a duplicate historical order -- not auto-deleted, review manually]" : ""}`));

  const duplicatesToDelete = [...bucketA, ...bucketB, ...bucketC].filter((b) => b.duplicateHistoricalOrderId);
  if (duplicatesToDelete.length > 0) {
    console.log(`\nDuplicate historical orders that will be deleted (same real-world order as the corrected real order above):`);
    duplicatesToDelete.forEach((b) => console.log(`  - ${b.sheetOrder.date} ${b.sheetOrder.customer}: historical order ${b.duplicateHistoricalOrderId}`));
  }

  if (unresolvedCustomers.size > 0) {
    console.log(`\nUnresolved customer names (skipped entirely):`);
    unresolvedCustomers.forEach((c, name) => console.log(`  - "${name}" (${c})`));
  }
  if (unresolvedProducts.size > 0) {
    console.log(`\nUnresolved products (that order's correction skipped):`);
    unresolvedProducts.forEach((c, name) => console.log(`  - "${name}" (${c})`));
  }
  const multiOrderCustomers = [...affectedCustomerOrderCounts.entries()].filter(([, n]) => n > 1);
  if (multiOrderCustomers.length > 0) {
    console.log(`\nCustomers with >1 affected order (bill prev_balance/net_due snapshots won't be retroactively recomputed across these):`);
    multiOrderCustomers.forEach(([cid, n]) => console.log(`  - ${cid}: ${n} orders`));
  }

  const billImpact = bucketB.reduce((sum, b) => sum + (b.newTotal - b.oldTotal), 0);
  const paidBillImpact = bucketC.reduce((sum, b) => sum + (b.newTotal - b.oldTotal), 0);
  console.log(`\nBucket B total bill impact: ₹${roundToCents(billImpact)}`);
  console.log(`Bucket C total bill impact (won't match amount paid): ₹${roundToCents(paidBillImpact)}`);
  console.log(`Bucket A total new revenue to record: ₹${roundToCents(bucketA.reduce((sum, b) => sum + b.lines.reduce((s, l) => s + roundLineAmount(l.qty, l.pricePerUnit), 0), 0))}`);

  if (!execute) {
    console.log("\nDry run only -- no writes made. Re-run with --execute to apply.");
    return;
  }

  // ---- EXECUTE ----

  async function reconcileLines(orderId: string, currentLines: { id: string; product_id: string | null }[], sheetLines: SheetLineResolved[]) {
    // Greedy consume-by-product, NOT a product-keyed Map on the current
    // side -- a real order can legitimately have more than one line for
    // the same product (two separate same-day WhatsApp pastes each
    // mentioning it, merged per CLAUDE.md §3.9's "append lines" rule, no
    // per-product dedup). sheetLines has at most one entry per product
    // (already merged/summed upstream), so each sheet line consumes ONE
    // unconsumed current line of that product if available; any current
    // lines left unconsumed afterward are genuinely excess and deleted.
    const currentByProduct = new Map<string, { id: string; product_id: string | null }[]>();
    for (const cl of currentLines) {
      if (!cl.product_id) continue;
      const list = currentByProduct.get(cl.product_id) ?? [];
      list.push(cl);
      currentByProduct.set(cl.product_id, list);
    }
    const consumed = new Set<string>();

    for (const sl of sheetLines) {
      const queue = currentByProduct.get(sl.productId);
      const existing = queue?.shift();
      if (existing) {
        consumed.add(existing.id);
        const { error } = await supabase.from("order_lines").update({
          ordered_qty: sl.qty, actual_qty: sl.qty, ordered_unit: sl.unit, locked_price_per_unit: sl.pricePerUnit, line_status: "packed",
        }).eq("id", existing.id);
        if (error) throw new Error(`Failed updating line ${existing.id}: ${error.message}`);
      } else {
        const { error } = await supabase.from("order_lines").insert({
          order_id: orderId, product_id: sl.productId, ordered_qty: sl.qty, ordered_unit: sl.unit,
          locked_price_per_unit: sl.pricePerUnit, actual_qty: sl.qty, line_status: "packed",
          is_substitution: false, parse_confidence: "clean", is_gift_box: sl.productId === GIFT_BOX_PRODUCT_ID,
        });
        if (error) throw new Error(`Failed inserting new line for order ${orderId}: ${error.message}`);
      }
    }
    for (const cl of currentLines) {
      if (!consumed.has(cl.id)) {
        // Every FK that can reference an order_line (checked against all
        // migrations, not guessed): gift_box_contents, price_overrides,
        // quantity_overrides (all order_line_id, not null -- can't null
        // these out, only remove), and order_lines.substituted_for_line_id
        // (self-ref, nullable). The sheet has no concept of substitution
        // or admin-override history, so once its data overrides this
        // order, that audit trail for the removed line is moot -- clear
        // it rather than leave it dangling and blocking deletion.
        await supabase.from("gift_box_contents").delete().eq("order_line_id", cl.id);
        await supabase.from("price_overrides").delete().eq("order_line_id", cl.id);
        await supabase.from("quantity_overrides").delete().eq("order_line_id", cl.id);
        await supabase.from("order_lines").update({ substituted_for_line_id: null }).eq("substituted_for_line_id", cl.id);
        const { error } = await supabase.from("order_lines").delete().eq("id", cl.id);
        if (error) throw new Error(`Failed deleting stale line ${cl.id}: ${error.message}`);
      }
    }
  }

  async function getSalutation(customerId: string, displayName: string): Promise<"Sir" | "Ma'am" | null> {
    const cached = (customers ?? []).find((c) => c.id === customerId)?.salutation as "Sir" | "Ma'am" | null | undefined;
    if (cached) return cached;
    const classified = await classifySalutation(displayName);
    if (classified === "unknown") return null;
    await supabase.from("customers").update({ salutation: classified }).eq("id", customerId);
    return classified;
  }

  async function deleteDuplicateHistorical(historicalOrderId: string | null) {
    if (!historicalOrderId) return;
    const { data: lineIds } = await supabase.from("order_lines").select("id").eq("order_id", historicalOrderId);
    const ids = (lineIds ?? []).map((l) => l.id);
    if (ids.length > 0) {
      // Same defensive FK cleanup as reconcileLines' deletion path --
      // historical rows are bulk-imported and never touched by the live
      // app's override/substitution UI, so these should all be no-ops in
      // practice, but don't assume that after today's lesson.
      await supabase.from("gift_box_contents").delete().in("order_line_id", ids);
      await supabase.from("price_overrides").delete().in("order_line_id", ids);
      await supabase.from("quantity_overrides").delete().in("order_line_id", ids);
      await supabase.from("order_lines").update({ substituted_for_line_id: null }).in("substituted_for_line_id", ids);
    }
    const { error: linesError } = await supabase.from("order_lines").delete().eq("order_id", historicalOrderId);
    if (linesError) throw new Error(`Failed deleting lines for duplicate historical order ${historicalOrderId}: ${linesError.message}`);
    const { error: orderError } = await supabase.from("orders").delete().eq("id", historicalOrderId);
    if (orderError) throw new Error(`Failed deleting duplicate historical order ${historicalOrderId}: ${orderError.message}`);
  }

  let completedA = 0, correctedB = 0, skippedSalutation = 0, duplicatesDeleted = 0;

  for (const item of bucketA) {
    await reconcileLines(item.order.id, item.order.order_lines ?? [], item.lines);

    const total = roundToCents(item.lines.reduce((sum, l) => sum + roundLineAmount(l.qty, l.pricePerUnit), 0));
    const { data: ledgerRows } = await supabase.from("ledger_entries").select("entry_type, amount").eq("customer_id", item.order.customer_id);
    const prevBalance = computeCustomerBalance((ledgerRows ?? []).map((r) => ({ entryType: r.entry_type as "debit" | "credit", amount: r.amount })));
    const netDue = computeNetDue(total, prevBalance);

    const salutation = await getSalutation(item.order.customer_id, item.sheetOrder.customer);
    if (!salutation) { skippedSalutation++; continue; }

    const billLines: BillLineItem[] = item.lines.map((l) => ({ productName: l.productName, actualQty: l.qty, unitLabel: null, ratePerUnit: l.pricePerUnit, amount: roundLineAmount(l.qty, l.pricePerUnit) }));
    const deliveryDateIso = item.sheetOrder.date;
    const messageText = buildBillMessage({ salutation, deliveryDate: deliveryDateIso, lines: billLines, total, prevBalance, netDue });

    const nowIso = new Date().toISOString();
    await supabase.from("orders").update({ status: "delivered", status_timestamps: { delivered: nowIso } }).eq("id", item.order.id);
    const { data: billRow, error: billError } = await supabase.from("bills").insert({ order_id: item.order.id, total, prev_balance: prevBalance, net_due: netDue, message_text: messageText, finalized_at: nowIso }).select("id").single();
    if (billError || !billRow) throw new Error(`Failed inserting bill for order ${item.order.id}: ${billError?.message}`);
    const { data: debitRow, error: debitError } = await supabase.from("ledger_entries").insert({ customer_id: item.order.customer_id, entry_type: "debit", amount: total, order_id: item.order.id }).select("id").single();
    if (debitError || !debitRow) throw new Error(`Failed inserting debit for order ${item.order.id}: ${debitError?.message}`);
    const { data: creditRow, error: creditError } = await supabase.from("ledger_entries").insert({ customer_id: item.order.customer_id, entry_type: "credit", amount: total, mode: "other", order_id: null, note: "Backfilled: sheet/OMS overlap correction, payment mode assumed" }).select("id").single();
    if (creditError || !creditRow) throw new Error(`Failed inserting credit for order ${item.order.id}: ${creditError?.message}`);
    const { error: allocError } = await supabase.from("payment_allocations").insert({ ledger_entry_id: creditRow.id, order_id: item.order.id, amount: total });
    if (allocError) throw new Error(`Failed allocating payment for order ${item.order.id}: ${allocError.message}`);

    if (item.duplicateHistoricalOrderId) { await deleteDuplicateHistorical(item.duplicateHistoricalOrderId); duplicatesDeleted++; }
    completedA++;
  }

  for (const item of bucketB) {
    await reconcileLines(item.order.id, item.order.order_lines ?? [], item.lines);
    const newTotal = roundToCents(item.lines.reduce((sum, l) => sum + roundLineAmount(l.qty, l.pricePerUnit), 0));

    const bill = billByOrderId.get(item.order.id)!;
    const { data: ledgerRows } = await supabase.from("ledger_entries").select("entry_type, amount").eq("customer_id", item.order.customer_id).neq("order_id", item.order.id);
    const prevBalance = computeCustomerBalance((ledgerRows ?? []).map((r) => ({ entryType: r.entry_type as "debit" | "credit", amount: r.amount })));
    const netDue = computeNetDue(newTotal, prevBalance);
    const billLines: BillLineItem[] = item.lines.map((l) => ({ productName: l.productName, actualQty: l.qty, unitLabel: null, ratePerUnit: l.pricePerUnit, amount: roundLineAmount(l.qty, l.pricePerUnit) }));
    const salutation = await getSalutation(item.order.customer_id, item.sheetOrder.customer);
    const deliveryDateIso = item.sheetOrder.date;
    const messageText = salutation ? buildBillMessage({ salutation, deliveryDate: deliveryDateIso, lines: billLines, total: newTotal, prevBalance, netDue }) : bill.message_text;

    const { error: billUpdateError } = await supabase.from("bills").update({ total: newTotal, net_due: netDue, message_text: messageText }).eq("id", bill.id);
    if (billUpdateError) throw new Error(`Failed updating bill for order ${item.order.id}: ${billUpdateError.message}`);
    const debit = debitByOrderId.get(item.order.id);
    if (debit) {
      const { error: debitUpdateError } = await supabase.from("ledger_entries").update({ amount: newTotal }).eq("id", debit.id);
      if (debitUpdateError) throw new Error(`Failed updating debit for order ${item.order.id}: ${debitUpdateError.message}`);
    }
    if (item.duplicateHistoricalOrderId) { await deleteDuplicateHistorical(item.duplicateHistoricalOrderId); duplicatesDeleted++; }
    correctedB++;
  }

  let correctedC = 0;
  for (const item of bucketC) {
    // Bill/lines corrected to match the sheet; ledger_entries and
    // payment_allocations are deliberately NEVER touched here -- that's
    // real money already collected against the old amount. bill.total
    // will legitimately no longer equal what was paid; the user
    // reconciles that gap manually (collect more, refund, or write off).
    await reconcileLines(item.order.id, item.order.order_lines ?? [], item.lines);
    const newTotal = roundToCents(item.lines.reduce((sum, l) => sum + roundLineAmount(l.qty, l.pricePerUnit), 0));

    const bill = billByOrderId.get(item.order.id)!;
    const { data: ledgerRows } = await supabase.from("ledger_entries").select("entry_type, amount").eq("customer_id", item.order.customer_id).neq("order_id", item.order.id);
    const prevBalance = computeCustomerBalance((ledgerRows ?? []).map((r) => ({ entryType: r.entry_type as "debit" | "credit", amount: r.amount })));
    const netDue = computeNetDue(newTotal, prevBalance);
    const billLines: BillLineItem[] = item.lines.map((l) => ({ productName: l.productName, actualQty: l.qty, unitLabel: null, ratePerUnit: l.pricePerUnit, amount: roundLineAmount(l.qty, l.pricePerUnit) }));
    const salutation = await getSalutation(item.order.customer_id, item.sheetOrder.customer);
    const deliveryDateIso = item.sheetOrder.date;
    const messageText = salutation ? buildBillMessage({ salutation, deliveryDate: deliveryDateIso, lines: billLines, total: newTotal, prevBalance, netDue }) : bill.message_text;

    const { error: billUpdateError } = await supabase.from("bills").update({ total: newTotal, net_due: netDue, message_text: messageText }).eq("id", bill.id);
    if (billUpdateError) throw new Error(`Failed updating bill for order ${item.order.id}: ${billUpdateError.message}`);

    if (item.duplicateHistoricalOrderId) { await deleteDuplicateHistorical(item.duplicateHistoricalOrderId); duplicatesDeleted++; }
    correctedC++;
  }

  console.log(`\nApplied. Bucket A completed: ${completedA} (${skippedSalutation} skipped pending salutation), Bucket B corrected: ${correctedB}, Bucket C corrected: ${correctedC} (ledger/payment untouched), duplicate historical orders deleted: ${duplicatesDeleted}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
