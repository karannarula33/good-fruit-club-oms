// Estimates packaging cost for Delhi / non-Gurgaon orders, which don't appear
// on the Gurgaon delivery-sheet packaging workbook. Estimate = the average
// packaging cost per sold line across orders that DO have packaging costed in
// the window, applied per sold line ("basis the items included"). Fills nulls
// only; skips internal customers (COGS/internal_customers.json).
//
// Run: npm run apply-delhi-packaging-estimate -- <from YYYY-MM-DD> <to YYYY-MM-DD> [--execute]

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createServiceRoleClient } from "../src/lib/supabase/service-role";

const DELHI = /new delhi|paschim vihar|greater kailash|punjabi bagh|nizamuddin|gulmohar|chanakyapuri|friends colony|kalkaji|ferozshah|derawal|ghitorni|mehrauli|\bdelhi\b|110\d{3}/i;
const GGN = /gurgaon|gurugram|haryana|122\d{3}/i;
const round2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const execute = process.argv.includes("--execute");
  const estimateAll = process.argv.includes("--all"); // estimate ALL no-box-data lines, not just Delhi
  const [lo, hi] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!lo || !hi) { console.error("Usage: npm run apply-delhi-packaging-estimate -- <from> <to> [--execute]"); process.exit(1); }
  console.log(`Mode: ${execute ? "EXECUTE" : "DRY RUN"} | window ${lo}..${hi}\n`);

  const internalPath = join(__dirname, "..", "COGS", "internal_customers.json");
  const internal = new Set<string>(existsSync(internalPath) ? (JSON.parse(readFileSync(internalPath, "utf-8")).customers ?? []).map((c: string) => c.toLowerCase()) : []);

  const sb = createServiceRoleClient();
  let from = 0; const all: any[] = [];
  for (;;) {
    const { data } = await sb.from("orders").select("delivery_date, customers!inner(display_name,address), order_lines(id, actual_qty, line_status, actual_packaging_cost)").gte("delivery_date", lo).lte("delivery_date", hi).neq("status", "cancelled").range(from, from + 999);
    if (!data || !data.length) break; all.push(...data); if (data.length < 1000) break; from += 1000;
  }

  // 1. Average packaging cost per sold line, from lines that ARE costed.
  let costSum = 0, costCount = 0;
  for (const o of all) for (const l of o.order_lines) {
    const sold = (l.actual_qty ?? 0) > 0 && l.line_status !== "unavailable";
    if (sold && l.actual_packaging_cost !== null) { costSum += Number(l.actual_packaging_cost); costCount++; }
  }
  if (!costCount) { console.error("No costed packaging lines in window to derive an average."); process.exit(1); }
  const avgPerLine = round2(costSum / costCount);
  console.log(`Avg packaging cost/line (from ${costCount} costed lines): ₹${avgPerLine}`);

  // 2. Delhi (non-Gurgaon) uncosted sold lines -> estimate.
  const lineIds: string[] = [];
  const perCust = new Map<string, number>();
  for (const o of all) {
    const addr = o.customers.address ?? "";
    const isDelhi = DELHI.test(addr) && !GGN.test(addr);
    if ((!estimateAll && !isDelhi) || internal.has(o.customers.display_name.toLowerCase())) continue;
    for (const l of o.order_lines) {
      const sold = (l.actual_qty ?? 0) > 0 && l.line_status !== "unavailable";
      if (sold && l.actual_packaging_cost === null) { lineIds.push(l.id); perCust.set(o.customers.display_name, (perCust.get(o.customers.display_name) ?? 0) + 1); }
    }
  }
  console.log(`Delhi uncosted sold lines to estimate: ${lineIds.length} across ${perCust.size} customers`);
  [...perCust.entries()].sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`  ${c}: ${n} lines -> ₹${round2(n * avgPerLine)}`));

  if (!execute) { console.log("\nDry run only. Re-run with --execute."); return; }
  for (let i = 0; i < lineIds.length; i += 500) {
    const { error } = await sb.from("order_lines").update({ actual_packaging_cost: avgPerLine }).in("id", lineIds.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  console.log(`\nApplied ₹${avgPerLine}/line to ${lineIds.length} Delhi order lines.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
