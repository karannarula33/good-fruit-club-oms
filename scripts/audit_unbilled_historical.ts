// Read-only audit: historical orders (is_historical=true) that have no
// bill row yet. Reports date-range breakdown, revenue at stake, and any
// blocking data issues (missing locked prices). Never writes anything.
//
// Run with: npx tsx --env-file=.env.local scripts/audit_unbilled_historical.ts

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { fetchAllRows } from "../src/lib/supabase/paginate";

async function main() {
  const supabase = createServiceRoleClient();

  const orders = await fetchAllRows<any>((from, to) =>
    supabase
      .from("orders")
      .select("id, delivery_date, customer_id, status")
      .eq("is_historical", true)
      .range(from, to),
  );
  console.log(`Total historical orders: ${orders.length}`);

  const bills = await fetchAllRows<any>((from, to) =>
    supabase.from("bills").select("order_id, total").range(from, to),
  );
  const billedOrderIds = new Set(bills.map((b: any) => b.order_id));

  const unbilled = orders.filter((o: any) => !billedOrderIds.has(o.id));
  console.log(`Historical orders with NO bill: ${unbilled.length}`);

  if (unbilled.length === 0) return;

  const unbilledIds = unbilled.map((o: any) => o.id);
  const lines: any[] = [];
  const CHUNK = 200;
  for (let i = 0; i < unbilledIds.length; i += CHUNK) {
    const chunk = unbilledIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("order_lines")
      .select("order_id, ordered_qty, actual_qty, locked_price_per_unit, line_status")
      .in("order_id", chunk);
    if (error) throw new Error(error.message);
    lines.push(...(data ?? []));
  }

  const linesByOrder = new Map<string, any[]>();
  for (const l of lines) {
    const arr = linesByOrder.get(l.order_id) ?? [];
    arr.push(l);
    linesByOrder.set(l.order_id, arr);
  }

  let totalRevenue = 0;
  let blockedCount = 0;
  const blockedOrders: string[] = [];
  const byDate = new Map<string, { count: number; revenue: number }>();

  for (const o of unbilled as any[]) {
    const ls = linesByOrder.get(o.id) ?? [];
    let orderTotal = 0;
    let blocked = false;
    for (const l of ls) {
      const qty = l.actual_qty ?? l.ordered_qty ?? 0;
      if (l.line_status === "unavailable") continue;
      if (l.locked_price_per_unit == null) {
        blocked = true;
        continue;
      }
      orderTotal += qty * l.locked_price_per_unit;
    }
    if (blocked) {
      blockedCount++;
      blockedOrders.push(o.id);
    }
    totalRevenue += orderTotal;
    const bucket = byDate.get(o.delivery_date) ?? { count: 0, revenue: 0 };
    bucket.count++;
    bucket.revenue += orderTotal;
    byDate.set(o.delivery_date, bucket);
  }

  console.log(`\nOrders blocked by missing locked_price_per_unit on a line: ${blockedCount}`);
  if (blockedCount) console.log("  order ids:", blockedOrders.slice(0, 20).join(", "), blockedOrders.length > 20 ? "..." : "");

  console.log(`\nTotal revenue at stake (unbilled historical orders): ₹${totalRevenue.toFixed(2)}`);

  console.log("\nBy delivery_date:");
  const sortedDates = [...byDate.keys()].sort();
  for (const d of sortedDates) {
    const b = byDate.get(d)!;
    console.log(`  ${d}: ${b.count} orders, ₹${b.revenue.toFixed(2)}`);
  }
  console.log(`\nDate range: ${sortedDates[0]} to ${sortedDates[sortedDates.length - 1]}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
