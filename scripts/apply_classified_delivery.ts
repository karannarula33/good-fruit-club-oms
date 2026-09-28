// Applies admin's classification of the uncosted (non-Mover-sheet) orders:
// Porter/Self costs entered directly (split across the order's sold lines);
// "Mover (missed on sheet)" or blank-cost rows estimated at the window's avg
// delivery cost/line; "Not delivered" skipped. Records the delivery method per
// order to COGS/delivery/_delivery_methods.json for P&L. Fills nulls only.
//
// Run: npm run apply-classified-delivery -- <classified-json> [--execute]

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServiceRoleClient } from "../src/lib/supabase/service-role";

const round2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const execute = process.argv.includes("--execute");
  const jsonPath = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!jsonPath) { console.error("Usage: npm run apply-classified-delivery -- <classified-json> [--execute]"); process.exit(1); }
  console.log(`Mode: ${execute ? "EXECUTE" : "DRY RUN"}\n`);

  const entries: { order_id: string; date: string; customer: string; method: string; cost: number | null }[] = JSON.parse(readFileSync(jsonPath, "utf-8"));
  const sb = createServiceRoleClient();

  // Window avg delivery cost per sold line, for estimating blank/Mover-missed.
  let from = 0; const win: any[] = [];
  for (;;) { const { data } = await sb.from("orders").select("order_lines(actual_qty,line_status,actual_delivery_cost)").gte("delivery_date", "2026-08-04").lte("delivery_date", "2026-09-26").neq("status", "cancelled").range(from, from + 999); if (!data || !data.length) break; win.push(...data); if (data.length < 1000) break; from += 1000; }
  let cs = 0, cc = 0;
  for (const o of win) for (const l of o.order_lines) { if ((l.actual_qty ?? 0) > 0 && l.line_status !== "unavailable" && l.actual_delivery_cost !== null) { cs += Number(l.actual_delivery_cost); cc++; } }
  const avgPerLine = round2(cs / cc);
  console.log(`Avg delivery cost/line (estimate basis, from ${cc} lines): ₹${avgPerLine}\n`);

  const { data: lineData } = await sb.from("order_lines").select("id, order_id, actual_qty, line_status, actual_delivery_cost").in("order_id", entries.map((e) => e.order_id));
  const linesByOrder = new Map<string, any[]>();
  for (const l of (lineData ?? [])) (linesByOrder.get(l.order_id) ?? linesByOrder.set(l.order_id, []).get(l.order_id)!).push(l);

  const updates: { id: string; cost: number }[] = [];
  const methods: any[] = [];
  let applied = 0, estimated = 0, skipped = 0;
  for (const e of entries) {
    if (e.method === "Not delivered") { methods.push({ ...e, applied_cost: 0, basis: "not_delivered" }); skipped++; continue; }
    const sold = (linesByOrder.get(e.order_id) ?? []).filter((l) => (l.actual_qty ?? 0) > 0 && l.line_status !== "unavailable");
    if (!sold.length) { methods.push({ ...e, applied_cost: 0, basis: "no_sold_lines" }); skipped++; continue; }
    const isEstimate = e.cost == null;
    const perLine = isEstimate ? avgPerLine : round2(e.cost! / sold.length);
    for (const l of sold) if (l.actual_delivery_cost === null) updates.push({ id: l.id, cost: perLine });
    methods.push({ order_id: e.order_id, date: e.date, customer: e.customer, method: e.method, applied_cost: round2(perLine * sold.length), basis: isEstimate ? "estimate" : "actual" });
    if (isEstimate) estimated++; else applied++;
  }

  console.log(`Entered cost (actual): ${applied} orders | estimated (blank/Mover-missed): ${estimated} | skipped (not delivered/no lines): ${skipped}`);
  console.log(`order_lines to fill: ${updates.length}`);

  if (!execute) { writeFileSync(join(__dirname, "..", "COGS", "delivery", "_delivery_methods.json"), JSON.stringify({ _note: "Delivery method + cost per order for orders not on the Mover sheet (admin-classified). basis: actual=entered, estimate=avg/line, not_delivered=skipped.", orders: methods }, null, 2) + "\n"); console.log("\nDry run only (wrote _delivery_methods.json for review). Re-run with --execute to write costs."); return; }

  const byCost = new Map<number, string[]>();
  for (const u of updates) byCost.set(u.cost, [...(byCost.get(u.cost) ?? []), u.id]);
  for (const [cost, ids] of byCost) for (let i = 0; i < ids.length; i += 500) { const { error } = await sb.from("order_lines").update({ actual_delivery_cost: cost }).in("id", ids.slice(i, i + 500)); if (error) throw new Error(error.message); }
  writeFileSync(join(__dirname, "..", "COGS", "delivery", "_delivery_methods.json"), JSON.stringify({ _note: "Delivery method + cost per order for orders not on the Mover sheet (admin-classified 2026-09-28). basis: actual=entered, estimate=avg/line, not_delivered=skipped.", orders: methods }, null, 2) + "\n");
  console.log(`\nApplied. ${updates.length} order_lines filled. Method log -> COGS/delivery/_delivery_methods.json`);
}
main().catch((e) => { console.error(e); process.exit(1); });
