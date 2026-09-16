// Read-only audit: ALL orders (historical + real) that have no bill,
// broken out by is_historical, to see the full scope of the billing gap
// beyond just the historical-import set.
//
// Run with: npx tsx --env-file=.env.local scripts/audit_unbilled_all.ts

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { fetchAllRows } from "../src/lib/supabase/paginate";

async function main() {
  const supabase = createServiceRoleClient();

  const orders = await fetchAllRows<any>((from, to) =>
    supabase.from("orders").select("id, delivery_date, status, is_historical").range(from, to),
  );
  const bills = await fetchAllRows<any>((from, to) =>
    supabase.from("bills").select("order_id").range(from, to),
  );
  const billedIds = new Set(bills.map((b: any) => b.order_id));

  console.log(`Total orders in DB: ${orders.length}`);
  const historical = orders.filter((o: any) => o.is_historical);
  const real = orders.filter((o: any) => !o.is_historical);
  console.log(`  historical: ${historical.length}, real: ${real.length}`);

  const unbilledHistorical = historical.filter((o: any) => !billedIds.has(o.id));
  const unbilledReal = real.filter((o: any) => !billedIds.has(o.id));
  console.log(`\nUnbilled historical: ${unbilledHistorical.length}`);
  console.log(`Unbilled real (non-historical): ${unbilledReal.length}`);

  if (unbilledReal.length) {
    console.log("\nUnbilled real orders by status:");
    const byStatus = new Map<string, number>();
    for (const o of unbilledReal as any[]) {
      byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
    }
    for (const [status, count] of byStatus) console.log(`  ${status}: ${count}`);

    console.log("\nUnbilled real orders by delivery_date (first 30):");
    const sorted = [...unbilledReal].sort((a: any, b: any) => a.delivery_date.localeCompare(b.delivery_date));
    for (const o of sorted.slice(0, 30) as any[]) {
      console.log(`  ${o.delivery_date}  ${o.id}  status=${o.status}`);
    }
    if (sorted.length > 30) console.log(`  ... and ${sorted.length - 30} more`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
