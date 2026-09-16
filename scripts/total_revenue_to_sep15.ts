// One-off: total revenue (actual_qty * locked_price_per_unit) across ALL
// orders placed_at < 2026-09-16 00:00 IST. Reuses the dashboard's revenue
// formula (roundLineAmount) rather than inventing a second definition.
//
// Run with: npx tsx --env-file=.env.local scripts/total_revenue_to_sep15.ts

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { fetchAllRows } from "../src/lib/supabase/paginate";
import { istWallClockToUtc } from "../src/lib/time/ist";
import { roundLineAmount, roundToCents } from "../src/lib/billing/compute";

async function main() {
  const supabase = createServiceRoleClient();
  const cutoffUtc = istWallClockToUtc("2026-09-16T00:00").toISOString();

  const orders = await fetchAllRows<any>((from, to) =>
    supabase
      .from("orders")
      .select("id, placed_at, is_historical, status")
      .lt("placed_at", cutoffUtc)
      .range(from, to),
  );
  const orderIds = orders.map((o: any) => o.id);
  const isHistoricalById = new Map(orders.map((o: any) => [o.id, o.is_historical]));

  const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
  function istMonth(placedAtIso: string): string {
    const shifted = new Date(new Date(placedAtIso).getTime() + IST_OFFSET_MS);
    return shifted.toISOString().slice(0, 7); // YYYY-MM
  }
  const monthByOrderId = new Map(orders.map((o: any) => [o.id, istMonth(o.placed_at)]));

  const CHUNK = 300;
  const lines: any[] = [];
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const chunk = orderIds.slice(i, i + CHUNK);
    const rows = await fetchAllRows<any>((from, to) =>
      supabase
        .from("order_lines")
        .select("order_id, actual_qty, locked_price_per_unit")
        .in("order_id", chunk)
        .range(from, to),
    );
    lines.push(...rows);
  }

  let revenue = 0;
  let revenueHistorical = 0;
  let revenueLive = 0;
  let lineCount = 0;
  const monthly = new Map<string, { revenue: number; historical: number; live: number; lines: number }>();
  for (const line of lines) {
    if (line.actual_qty === null || line.locked_price_per_unit === null) continue;
    const amt = roundLineAmount(line.actual_qty, line.locked_price_per_unit);
    revenue += amt;
    lineCount += 1;
    const historical = isHistoricalById.get(line.order_id);
    if (historical) revenueHistorical += amt;
    else revenueLive += amt;

    const month = monthByOrderId.get(line.order_id)!;
    const entry = monthly.get(month) ?? { revenue: 0, historical: 0, live: 0, lines: 0 };
    entry.revenue += amt;
    entry.lines += 1;
    if (historical) entry.historical += amt;
    else entry.live += amt;
    monthly.set(month, entry);
  }

  console.log(`Orders (placed_at < 2026-09-16 00:00 IST): ${orders.length}`);
  console.log(`  historical: ${orders.filter((o: any) => o.is_historical).length}`);
  console.log(`  live: ${orders.filter((o: any) => !o.is_historical).length}`);
  console.log(`Order lines with actuals + locked price: ${lineCount}`);
  console.log(`\nTotal revenue: ₹${roundToCents(revenue).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`);
  console.log(`  from historical (backfilled) orders: ₹${roundToCents(revenueHistorical).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`);
  console.log(`  from live orders: ₹${roundToCents(revenueLive).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`);

  console.log(`\nBy month (IST):`);
  for (const [month, v] of [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const fmt = (n: number) => `₹${roundToCents(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
    console.log(`  ${month}: ${fmt(v.revenue)}  (historical ${fmt(v.historical)}, live ${fmt(v.live)}, ${v.lines} lines)`);
  }
}

main();
