// One-time historical order import (CLAUDE_engagement_engine_FINAL.md §12).
// Reads the exported "Orders" sheet -- a wide format where each order's
// first row carries Date/#/Customer/Phone/Address and any additional
// fruit lines for that same order follow as blank-continuation rows --
// and inserts full orders + order_lines rows flagged is_historical = true.
// Never touches bills/ledger_entries/payment_allocations (§12.1).
//
// Idempotent: always deletes existing is_historical rows first, then
// re-imports fresh from the CSV -- safe to re-run as the sheet grows
// (e.g. once 3-5 Aug rows are added) or aliases get fixed.
//
// Run with: npm run import:historical-orders -- "<path-to-csv>" [--execute]
// Defaults to a dry run (report only, no writes) unless --execute is passed.

import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { deriveZoneFromAddress, type Zone } from "../src/lib/customers/zone";
import { createServiceRoleClient } from "../src/lib/supabase/service-role";

const GO_LIVE_CUTOFF_ISO = "2026-08-06"; // strictly-before this date is imported (§12.2.3)

// Fruit-column labels that are adjustments, not products -- excluded from
// order_lines, folded into the order's notes instead.
const NON_PRODUCT_FRUIT_LABELS = new Set(["Special Discount"]);

const COL = {
  date: 1, num: 2, customer: 3, phone: 4, address: 5, fruit: 6,
  qty: 7, size: 8, sellPrice: 9, cogs: 10, notes: 15,
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
  if (digits.length < 7) return null; // filters stray junk like a bare "\"
  return digits.slice(-10);
}

interface SheetOrder {
  date: string;
  num: string;
  customer: string;
  phone: string | null;
  address: string;
  notes: string;
  lines: { fruit: string; qty: string; size: string; sellPrice: string; cogs: string }[];
}

function parseSheet(csvPath: string): { orders: SheetOrder[]; skippedFooterRows: number } {
  const raw = readFileSync(csvPath, "utf-8");
  const rows: string[][] = parse(raw, { columns: false, relax_column_count: true, skip_empty_lines: true });

  const headerIndex = rows.findIndex((r) => r[COL.date]?.trim() === "Date" && r[COL.fruit]?.trim() === "Fruit");
  if (headerIndex === -1) throw new Error('Could not find the "Date"/"Fruit" header row in the CSV');

  const data = rows.slice(headerIndex + 1);

  let currentDate = "", currentNum = "", currentCustomer = "", currentPhone = "", currentAddress = "";
  const grouped = new Map<string, SheetOrder>();
  let skippedFooterRows = 0;

  for (const r of data) {
    const rawDate = (r[COL.date] ?? "").trim();
    const rawNum = (r[COL.num] ?? "").trim();
    const rawCustomer = (r[COL.customer] ?? "").trim();
    const rawPhone = (r[COL.phone] ?? "").trim();
    const rawAddress = (r[COL.address] ?? "").trim();
    const fruit = (r[COL.fruit] ?? "").trim();
    const notes = (r[COL.notes] ?? "").trim();

    // Only accept a new value for each forward-filled field if it looks
    // like real data -- guards against stray junk in continuation rows
    // (a bare "\" once appears in the phone column of a blank row) and
    // against the sheet's own trailing DAILY SUMMARY/Total orders footer
    // block, whose "date" column doesn't parse as a real date.
    if (rawDate && toIso(rawDate)) currentDate = rawDate;
    if (rawNum) currentNum = rawNum;
    if (rawCustomer) currentCustomer = rawCustomer;
    if (rawPhone && normalizePhone(rawPhone)) currentPhone = rawPhone;
    if (rawAddress) currentAddress = rawAddress;

    if (!fruit) continue;
    if (rawDate && !toIso(rawDate)) {
      skippedFooterRows++; // this row's own date is the footer block, e.g. "Total orders"
      continue;
    }
    if (!currentDate || !currentNum) continue;

    // Order "#" is a per-day sequence, not a global id (it resets/repeats
    // across different dates) -- date+# together is the real order key.
    const key = `${currentDate}__${currentNum}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        date: currentDate, num: currentNum, customer: currentCustomer,
        phone: currentPhone || null, address: currentAddress, notes: "", lines: [],
      });
    }
    const order = grouped.get(key)!;
    if (notes && !order.notes.includes(notes)) {
      order.notes = order.notes ? `${order.notes}; ${notes}` : notes;
    }
    order.lines.push({
      fruit, qty: (r[COL.qty] ?? "").trim(), size: (r[COL.size] ?? "").trim(),
      sellPrice: (r[COL.sellPrice] ?? "").trim(), cogs: (r[COL.cogs] ?? "").trim(),
    });
  }

  return { orders: [...grouped.values()], skippedFooterRows };
}

async function main() {
  const execute = process.argv.includes("--execute");
  const csvArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const csvPath = csvArg ?? path.join(__dirname, "..", "Good Fruit Club - Master Dashboard - Orders (1).csv");

  console.log(`Mode: ${execute ? "EXECUTE (will write)" : "DRY RUN (no writes)"}`);
  console.log(`Reading: ${csvPath}\n`);

  const { orders: sheetOrders, skippedFooterRows } = parseSheet(csvPath);
  console.log(`Parsed ${sheetOrders.length} orders from the sheet (${skippedFooterRows} footer/summary rows skipped).`);

  const beforeCutoff = sheetOrders.filter((o) => (toIso(o.date) ?? "9999-99-99") < GO_LIVE_CUTOFF_ISO);
  const onOrAfterCutoff = sheetOrders.length - beforeCutoff.length;
  console.log(`${beforeCutoff.length} orders strictly before cutoff (${GO_LIVE_CUTOFF_ISO}); ${onOrAfterCutoff} on/after cutoff excluded.\n`);

  const supabase = createServiceRoleClient();

  const [{ data: products }, { data: aliases }] = await Promise.all([
    supabase.from("products").select("id, name"),
    supabase.from("product_aliases").select("alias, product_id"),
  ]);
  const productByLowerName = new Map((products ?? []).map((p) => [p.name.toLowerCase(), p.id]));
  const productByLowerAlias = new Map((aliases ?? []).map((a) => [a.alias.toLowerCase(), a.product_id]));
  function resolveProduct(fruitRaw: string): string | null {
    const key = fruitRaw.trim().toLowerCase();
    return productByLowerName.get(key) ?? productByLowerAlias.get(key) ?? null;
  }

  const { data: existingCustomers } = await supabase.from("customers").select("id, display_name, phone, address");
  const customerByPhone = new Map(
    (existingCustomers ?? []).filter((c) => c.phone).map((c) => [normalizePhone(c.phone as string), c]),
  );
  const customerByLowerName = new Map((existingCustomers ?? []).map((c) => [c.display_name.toLowerCase(), c]));

  const newCustomers: { key: string; display_name: string; phone: string | null; address: string; zone: Zone }[] = [];
  const customerKeyToId = new Map<string, string>();

  function customerKeyFor(o: SheetOrder): { key: string; existingId: string | null } {
    const normPhone = o.phone ? normalizePhone(o.phone) : null;
    if (normPhone && customerByPhone.has(normPhone)) {
      return { key: `phone:${normPhone}`, existingId: customerByPhone.get(normPhone)!.id };
    }
    const byName = customerByLowerName.get(o.customer.toLowerCase());
    if (byName) return { key: `name:${o.customer.toLowerCase()}`, existingId: byName.id };
    return { key: normPhone ? `phone:${normPhone}` : `name:${o.customer.toLowerCase()}`, existingId: null };
  }

  const unresolvedProducts = new Map<string, number>();
  const skippedOrders: { order: SheetOrder; reason: string }[] = [];
  const droppedDiscountLines: { order: SheetOrder; amount: string }[] = [];

  interface PlannedOrder {
    id: string;
    customerKey: string;
    placedAtIso: string;
    notes: string | null;
    lines: { productId: string; orderedQty: number; orderedUnit: string; lockedPrice: number; lockedCogs: number | null }[];
  }
  const planned: PlannedOrder[] = [];

  for (const o of beforeCutoff) {
    const iso = toIso(o.date);
    if (!iso) { skippedOrders.push({ order: o, reason: "unparseable date" }); continue; }
    if (!o.address) { skippedOrders.push({ order: o, reason: "missing address" }); continue; }

    let hadUnresolvedProduct = false;
    const lines: PlannedOrder["lines"] = [];
    const adjustmentNotes: string[] = [];

    for (const l of o.lines) {
      if (NON_PRODUCT_FRUIT_LABELS.has(l.fruit)) {
        adjustmentNotes.push(`Discount (sheet): ${l.sellPrice}`);
        droppedDiscountLines.push({ order: o, amount: l.sellPrice });
        continue;
      }
      const productId = resolveProduct(l.fruit);
      if (!productId) {
        unresolvedProducts.set(l.fruit, (unresolvedProducts.get(l.fruit) ?? 0) + 1);
        hadUnresolvedProduct = true;
        continue;
      }
      const qty = parseFloat(l.qty.replace(/,/g, ""));
      // "Sell Price" and "COGS" in this sheet are LINE TOTALS (qty x rate),
      // not per-unit prices -- confirmed by cross-checking price/qty for
      // every Chausa Mango line (consistently ~285, its known per-kg rate)
      // and by the sheet's own DAILY SUMMARY revenue total. order_lines'
      // locked_price_per_unit/locked_cogs_per_unit are genuinely per-unit,
      // so divide through by qty here.
      const totalPrice = parseFloat(l.sellPrice.replace(/,/g, ""));
      const totalCogs = parseFloat(l.cogs.replace(/,/g, ""));
      // Non-positive qty is how this sheet records refunds/credits against
      // an earlier order (e.g. "Muscat Grapes qty -1"), not a real line --
      // drop it into notes rather than blocking the whole order's real lines.
      if (!Number.isFinite(qty) || qty <= 0) {
        adjustmentNotes.push(`Adjustment (sheet): ${l.fruit} qty ${l.qty} = ${l.sellPrice}`);
        droppedDiscountLines.push({ order: o, amount: l.sellPrice });
        continue;
      }
      if (!Number.isFinite(totalPrice)) {
        hadUnresolvedProduct = true;
        continue;
      }
      lines.push({
        productId, orderedQty: qty, orderedUnit: l.size.trim().toLowerCase(),
        lockedPrice: Math.round((totalPrice / qty) * 100) / 100,
        lockedCogs: Number.isFinite(totalCogs) ? Math.round((totalCogs / qty) * 100) / 100 : null,
      });
    }

    if (hadUnresolvedProduct) { skippedOrders.push({ order: o, reason: "unresolved product / bad line data" }); continue; }
    if (lines.length === 0) { skippedOrders.push({ order: o, reason: "no importable lines" }); continue; }

    const { key, existingId } = customerKeyFor(o);
    if (!existingId && !customerKeyToId.has(key) && !newCustomers.some((c) => c.key === key)) {
      newCustomers.push({ key, display_name: o.customer, phone: o.phone, address: o.address, zone: deriveZoneFromAddress(o.address) });
    }
    if (existingId) customerKeyToId.set(key, existingId);

    const combinedNotes = [o.notes, ...adjustmentNotes].filter(Boolean).join("; ") || null;
    planned.push({ id: randomUUID(), customerKey: key, placedAtIso: iso, notes: combinedNotes, lines });
  }

  console.log(`Orders resolved cleanly: ${planned.length}`);
  console.log(`Orders skipped: ${skippedOrders.length}`);
  const skipReasonCounts = new Map<string, number>();
  for (const s of skippedOrders) skipReasonCounts.set(s.reason, (skipReasonCounts.get(s.reason) ?? 0) + 1);
  for (const [reason, count] of skipReasonCounts) console.log(`  - ${reason}: ${count}`);
  skippedOrders.slice(0, 10).forEach((s) => console.log(`    e.g. ${s.order.date} #${s.order.num} ${s.order.customer}: ${s.reason}`));

  console.log(`\nUnresolved product names (blocked their whole order):`);
  if (unresolvedProducts.size === 0) console.log("  none");
  for (const [fruit, count] of unresolvedProducts) console.log(`  - "${fruit}" (${count} occurrence(s))`);

  console.log(`\nDiscount-adjustment lines dropped from order_lines (kept as an order note instead): ${droppedDiscountLines.length}`);

  console.log(`\nNew customers to create: ${newCustomers.length}`);
  const zoneCounts = new Map<string, number>();
  for (const c of newCustomers) zoneCounts.set(c.zone, (zoneCounts.get(c.zone) ?? 0) + 1);
  for (const [zone, count] of zoneCounts) console.log(`  ${zone}: ${count}`);

  const totalLines = planned.reduce((sum, o) => sum + o.lines.length, 0);
  const linesMissingCogs = planned.reduce((sum, o) => sum + o.lines.filter((l) => l.lockedCogs === null).length, 0);
  const revenue = planned.reduce((sum, o) => sum + o.lines.reduce((s, l) => s + l.orderedQty * l.lockedPrice, 0), 0);
  console.log(`\nTotal order_lines to insert: ${totalLines} (${linesMissingCogs} with no COGS -> locked_cogs_per_unit null)`);
  console.log(`Total historical revenue represented: Rs ${revenue.toFixed(2)}`);

  if (!execute) {
    console.log("\nDry run only -- no writes made. Re-run with --execute to apply.");
    return;
  }

  console.log("\nDeleting any existing is_historical rows (idempotent re-import)...");
  const { data: existingHistorical } = await supabase.from("orders").select("id").eq("is_historical", true);
  const existingHistoricalIds = (existingHistorical ?? []).map((o) => o.id);
  if (existingHistoricalIds.length > 0) {
    await supabase.from("order_lines").delete().in("order_id", existingHistoricalIds);
    await supabase.from("orders").delete().in("id", existingHistoricalIds);
    console.log(`  removed ${existingHistoricalIds.length} previously-imported historical orders`);
  }

  if (newCustomers.length > 0) {
    const { data: inserted, error } = await supabase
      .from("customers")
      .insert(newCustomers.map((c) => ({ display_name: c.display_name, phone: c.phone, address: c.address, zone: c.zone })))
      .select("id");
    if (error) throw new Error(`Failed to insert new customers: ${error.message}`);
    (inserted ?? []).forEach((row, i) => customerKeyToId.set(newCustomers[i].key, row.id));
    console.log(`  created ${inserted?.length ?? 0} new customers`);
  }

  const orderRows = planned.map((o) => ({
    id: o.id,
    customer_id: customerKeyToId.get(o.customerKey)!,
    placed_at: `${o.placedAtIso}T09:00:00+05:30`,
    delivery_date: o.placedAtIso,
    status: "delivered" as const,
    status_timestamps: { delivered: `${o.placedAtIso}T09:00:00+05:30` },
    raw_paste: null,
    notes: o.notes,
    is_historical: true,
    created_by: null,
  }));

  const CHUNK = 200;
  for (let i = 0; i < orderRows.length; i += CHUNK) {
    const { error } = await supabase.from("orders").insert(orderRows.slice(i, i + CHUNK));
    if (error) throw new Error(`Failed inserting orders chunk ${i}: ${error.message}`);
  }
  console.log(`  inserted ${orderRows.length} orders`);

  const lineRows = planned.flatMap((o) =>
    o.lines.map((l) => ({
      order_id: o.id,
      product_id: l.productId,
      ordered_qty: l.orderedQty,
      ordered_unit: l.orderedUnit,
      locked_price_per_unit: l.lockedPrice,
      locked_cogs_per_unit: l.lockedCogs,
      actual_qty: l.orderedQty,
      line_status: "packed" as const,
      is_substitution: false,
      parse_confidence: "clean" as const,
      parse_note: null,
    })),
  );
  for (let i = 0; i < lineRows.length; i += CHUNK) {
    const { error } = await supabase.from("order_lines").insert(lineRows.slice(i, i + CHUNK));
    if (error) throw new Error(`Failed inserting order_lines chunk ${i}: ${error.message}`);
  }
  console.log(`  inserted ${lineRows.length} order_lines`);

  console.log("\nDone. Next: run the engine's STEP 1 once to backfill eng_customer_state (slice 1, not built yet).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
