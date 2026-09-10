// Applies a day's delivery costs to that day's live order_lines: a flat
// hub-to-Gurgaon leg split evenly across every line placed that day, plus
// each order's own Gurgaon-to-customer leg split across that order's
// lines. Part of the go-forward cost-capture workflow (chat-driven, not
// an in-app screen -- see 0024_cost_ingestion_config.sql's header).
//
// Input JSON shape: [{ "customer": "Nikhila Oberoi", "cost": 60 }, ...]
// -- the per-order Gurgaon-leg cost, matching the owner's existing daily
// delivery-cost sheet's natural key (customer name, not order id).
//
// The hub-cost denominator is EVERY line placed that day, not just the
// orders present in this JSON -- matches how the original sheet's own
// flat-fee formulas worked (divide by that day's total item count), so an
// incomplete list still gets the split right for the orders it does cover.
//
// Never overwrites an existing actual_delivery_cost -- only fills nulls.
//
// Run with: npm run apply-daily-delivery-costs -- <YYYY-MM-DD> <hub-cost> <path-to-json> [--execute]
// Defaults to a dry run.

import { readFileSync } from "node:fs";
import { createServiceRoleClient } from "../src/lib/supabase/service-role";

interface DeliveryInputLine {
  customer: string;
  cost: number;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const [entryDate, hubCostRaw, jsonPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const hubCost = Number(hubCostRaw);
  if (!entryDate || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate) || !Number.isFinite(hubCost) || hubCost <= 0 || !jsonPath) {
    console.error("Usage: npm run apply-daily-delivery-costs -- <YYYY-MM-DD> <hub-cost> <path-to-json> [--execute]");
    process.exit(1);
  }

  console.log(`Mode: ${execute ? "EXECUTE (will write)" : "DRY RUN (no writes)"}`);
  console.log(`Date: ${entryDate}, hub cost: ${hubCost}\n`);

  const inputLines: DeliveryInputLine[] = JSON.parse(readFileSync(jsonPath, "utf-8"));
  const supabase = createServiceRoleClient();

  const dayStart = `${entryDate}T00:00:00+05:30`;
  const dayEnd = new Date(new Date(`${entryDate}T00:00:00+05:30`).getTime() + 24 * 60 * 60 * 1000).toISOString();

  // Every live order placed that day, with its customer's name and its
  // line count -- the full universe, used both for name resolution and
  // for the hub-cost denominator.
  const { data: dayOrders, error: ordersError } = await supabase
    .from("orders")
    .select("id, customers!inner(display_name), order_lines(id)")
    .eq("is_historical", false)
    .gte("placed_at", dayStart)
    .lt("placed_at", dayEnd);
  if (ordersError) throw new Error(`Failed loading that day's orders: ${ordersError.message}`);

  const orders = (dayOrders ?? []) as unknown as {
    id: string;
    customers: { display_name: string };
    order_lines: { id: string }[];
  }[];

  const totalLinesThatDay = orders.reduce((sum, o) => sum + o.order_lines.length, 0);
  if (totalLinesThatDay === 0) {
    console.log("No live order_lines found for this date -- nothing to do.");
    return;
  }

  const ordersByLowerName = new Map<string, typeof orders>();
  for (const o of orders) {
    const key = o.customers.display_name.toLowerCase();
    ordersByLowerName.set(key, [...(ordersByLowerName.get(key) ?? []), o]);
  }

  const resolved: { orderId: string; customer: string; cost: number; lineIds: string[] }[] = [];
  const unresolved: { customer: string; reason: string }[] = [];

  for (const line of inputLines) {
    if (!Number.isFinite(line.cost) || line.cost <= 0) {
      unresolved.push({ customer: line.customer, reason: `invalid cost ${line.cost}` });
      continue;
    }
    const matches = ordersByLowerName.get(line.customer.trim().toLowerCase());
    if (!matches || matches.length === 0) {
      unresolved.push({ customer: line.customer, reason: "no live order for this customer on this date" });
      continue;
    }
    if (matches.length > 1) {
      unresolved.push({ customer: line.customer, reason: `${matches.length} orders match this name+date, ambiguous` });
      continue;
    }
    resolved.push({ orderId: matches[0].id, customer: line.customer, cost: line.cost, lineIds: matches[0].order_lines.map((l) => l.id) });
  }

  console.log(`Total lines placed this date (hub-cost denominator): ${totalLinesThatDay}`);
  console.log(`Resolved: ${resolved.length}/${inputLines.length}`);
  if (unresolved.length > 0) {
    console.log(`Unresolved (need a manual match before these can apply):`);
    unresolved.forEach((u) => console.log(`  - "${u.customer}": ${u.reason}`));
  }

  const hubShare = Math.round((hubCost / totalLinesThatDay) * 100) / 100;

  let totalLinesUpdated = 0;
  let totalLinesAlreadySet = 0;
  const perOrder: { customer: string; cost: number; perLine: number; updated: number; alreadySet: number }[] = [];

  for (const item of resolved) {
    const orderShare = item.lineIds.length > 0 ? item.cost / item.lineIds.length : 0;
    const perLine = Math.round((hubShare + orderShare) * 100) / 100;

    const { data: existingLines, error: linesError } = await supabase
      .from("order_lines")
      .select("id, actual_delivery_cost")
      .in("id", item.lineIds);
    if (linesError) throw new Error(`Failed loading lines for "${item.customer}": ${linesError.message}`);

    const toUpdate = (existingLines ?? []).filter((l) => l.actual_delivery_cost === null);
    const alreadySet = (existingLines ?? []).length - toUpdate.length;
    perOrder.push({ customer: item.customer, cost: item.cost, perLine, updated: toUpdate.length, alreadySet });
    totalLinesUpdated += toUpdate.length;
    totalLinesAlreadySet += alreadySet;

    if (execute && toUpdate.length > 0) {
      const { error: updateError } = await supabase
        .from("order_lines")
        .update({ actual_delivery_cost: perLine })
        .in("id", toUpdate.map((l) => l.id));
      if (updateError) throw new Error(`Failed updating order_lines for "${item.customer}": ${updateError.message}`);
    }
  }

  console.log(`\nPer order (hub share ${hubShare}/line + order-specific share):`);
  perOrder.forEach((o) => console.log(`  ${o.customer}: order cost ${o.cost} -> ${o.perLine}/line, ${o.updated} lines to update, ${o.alreadySet} already set (untouched)`));
  console.log(`\nTotal: ${totalLinesUpdated} lines to update, ${totalLinesAlreadySet} already set (untouched)`);

  if (!execute) {
    console.log("\nDry run only -- no writes made. Re-run with --execute to apply.");
    return;
  }

  const { error: hubUpsertError } = await supabase
    .from("daily_delivery_hub_costs")
    .upsert({ entry_date: entryDate, hub_cost: hubCost }, { onConflict: "entry_date" });
  if (hubUpsertError) throw new Error(`Failed upserting daily_delivery_hub_costs: ${hubUpsertError.message}`);

  if (resolved.length > 0) {
    const { error: orderCostUpsertError } = await supabase
      .from("order_delivery_costs")
      .upsert(
        resolved.map((item) => ({ order_id: item.orderId, delivery_cost: item.cost })),
        { onConflict: "order_id" },
      );
    if (orderCostUpsertError) throw new Error(`Failed upserting order_delivery_costs: ${orderCostUpsertError.message}`);
  }

  console.log(`\nApplied. ${totalLinesUpdated} order_lines updated, ${resolved.length} order_delivery_costs rows recorded.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
