// Allocates packer wage into order_lines.actual_labour_cost (admin: include
// packer pay in per-order cost). Each pay period's wage is spread evenly across
// that period's sold order-lines (excluding internal customers). Requires
// migration 0025 applied first.
//
// Salary is per CALENDAR MONTH, paid on the 10th of the following month
// (admin 2026-09-28). Allocated across each month's sold order-lines:
//   Jul (3–31) = 7000  (paid 10 Aug, incl extras/leaves)
//   Aug (1–31) = 8130  (paid 10 Sep)
//   Sep (1–30) = 8774  (8000 base + 4 Sundays worked - 1 leave, each at
//                8000/31 = 258.06; admin 2026-10-08; paid ~10 Oct)
//
// Run: npm run apply-packer-labour -- [--execute]  (dry-run by default)

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createServiceRoleClient } from "../src/lib/supabase/service-role";

const round2 = (n: number) => Math.round(n * 100) / 100;
const PERIODS = [
  { from: "2026-07-03", to: "2026-07-31", amount: 7000, basis: "actual (Jul, paid 10 Aug)" },
  { from: "2026-08-01", to: "2026-08-31", amount: 8130, basis: "actual (Aug, paid 10 Sep)" },
  { from: "2026-09-01", to: "2026-09-30", amount: 8774, basis: "actual (Sep: 8000 base + 4 Sundays - 1 leave @ 8000/31)" },
];

async function main() {
  const execute = process.argv.includes("--execute");
  console.log(`Mode: ${execute ? "EXECUTE" : "DRY RUN"}\n`);

  const internalPath = join(__dirname, "..", "COGS", "internal_customers.json");
  const internal = new Set<string>(existsSync(internalPath) ? (JSON.parse(readFileSync(internalPath, "utf-8")).customers ?? []).map((c: string) => c.toLowerCase()) : []);

  const sb = createServiceRoleClient();
  let grandLines = 0, grandCost = 0;
  const updates: { id: string; cost: number }[] = [];

  for (const p of PERIODS) {
    let from = 0; const rows: any[] = [];
    for (;;) { const { data, error } = await sb.from("orders").select("customers!inner(display_name), order_lines(id, actual_qty, line_status)").gte("delivery_date", p.from).lte("delivery_date", p.to).neq("status", "cancelled").range(from, from + 999); if (error) throw new Error(error.message); if (!data || !data.length) break; rows.push(...data); if (data.length < 1000) break; from += 1000; }
    const soldIds: string[] = [];
    for (const o of rows) { if (internal.has(o.customers.display_name.toLowerCase())) continue; for (const l of o.order_lines) if ((l.actual_qty ?? 0) > 0 && l.line_status !== "unavailable") soldIds.push(l.id); }
    const perLine = soldIds.length ? round2(p.amount / soldIds.length) : 0;
    console.log(`${p.from}..${p.to}: ₹${p.amount} / ${soldIds.length} sold lines = ₹${perLine}/line  [${p.basis}]`);
    for (const id of soldIds) updates.push({ id, cost: perLine });
    grandLines += soldIds.length; grandCost += p.amount;
  }
  console.log(`\nTotal: ₹${grandCost} across ${grandLines} lines.`);

  if (!execute) { console.log("\nDry run only. Apply migration 0025 first, then re-run with --execute."); return; }
  const byCost = new Map<number, string[]>();
  for (const u of updates) byCost.set(u.cost, [...(byCost.get(u.cost) ?? []), u.id]);
  for (const [cost, ids] of byCost) for (let i = 0; i < ids.length; i += 500) { const { error } = await sb.from("order_lines").update({ actual_labour_cost: cost } as never).in("id", ids.slice(i, i + 500)); if (error) throw new Error(error.message); }
  console.log(`\nApplied packer labour to ${updates.length} order_lines.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
