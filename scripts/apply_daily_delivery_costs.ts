// Applies a delivery day's two-leg delivery cost to that day's order_lines:
//
//   1. A flat HUB charge (West Delhi -> Gurgaon, ~500-600/day) split EQUALLY
//      PER ITEM across that day's Gurgaon deliveries.
//   2. Each order's own Gurgaon-leg MOVER charge (our 3P), split across that
//      order's items.
//
// per-line actual_delivery_cost = hubPerItem + (moverOrderCost / order's items)
//
// "That day's Gurgaon deliveries" = exactly the orders present in the input
// JSON (the Mover sheet). Mover is the Gurgaon 3P, so an order having a Mover
// line IS the signal it was delivered in Gurgaon. Any non-cancelled order on
// this delivery_date that is NOT in the JSON is treated as non-Gurgaon
// (Delhi/outside): it gets no hub share and is reported so the admin can
// confirm that's correct. (The zone column is unreliable for this -- many
// Gurgaon customers sit under "Unassigned" -- so the Mover sheet is the
// authority, not the zone.)
//
// Everything keys off delivery_date (the day the trip + drops happen), NOT
// placed_at, and covers BOTH live and historical (imported) orders -- the
// Aug 4-27 window is mostly historical. Cancelled orders are excluded.
//
// "Items" = SOLD lines only (line_status != 'unavailable' AND actual_qty > 0),
// same basis as COGS -- unavailable/undelivered items were never transported,
// so they carry no delivery cost and don't count in the hub denominator.
//
// Never overwrites an existing actual_delivery_cost -- only fills nulls.
//
// Input JSON shape: [{ "customer": "Nikhila Oberoi", "cost": 60 }, ...]
//   cost = that order's Mover (Gurgaon-leg) charge; 0 is allowed (a Gurgaon
//   order that rode the hub trip with no separate 3P charge).
//
// Run with: npm run apply-daily-delivery-costs -- <YYYY-MM-DD> <hub-cost> <path-to-json> [--execute]
// Defaults to a dry run.

import { readFileSync } from "node:fs";
import { createServiceRoleClient } from "../src/lib/supabase/service-role";

interface DeliveryInputLine {
  customer: string;
  cost: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const execute = process.argv.includes("--execute");
  const [entryDate, hubCostRaw, jsonPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const hubCost = Number(hubCostRaw);
  if (!entryDate || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate) || !Number.isFinite(hubCost) || hubCost < 0 || !jsonPath) {
    console.error("Usage: npm run apply-daily-delivery-costs -- <YYYY-MM-DD> <hub-cost> <path-to-json> [--execute]");
    process.exit(1);
  }

  console.log(`Mode: ${execute ? "EXECUTE (will write)" : "DRY RUN (no writes)"}`);
  console.log(`Delivery date: ${entryDate}, hub cost: ${hubCost}\n`);

  const inputLines: DeliveryInputLine[] = JSON.parse(readFileSync(jsonPath, "utf-8"));
  const supabase = createServiceRoleClient();

  // Every non-cancelled order delivered that day (live + historical), with its
  // customer name and its lines. Keyed on delivery_date, not placed_at.
  const { data: dayOrders, error: ordersError } = await supabase
    .from("orders")
    .select("id, status, customers!inner(display_name), order_lines(id, actual_qty, line_status, actual_delivery_cost)")
    .eq("delivery_date", entryDate)
    .neq("status", "cancelled");
  if (ordersError) throw new Error(`Failed loading that day's orders: ${ordersError.message}`);

  type Line = { id: string; actual_qty: number | null; line_status: string; actual_delivery_cost: number | null };
  const orders = (dayOrders ?? []) as unknown as {
    id: string;
    status: string;
    customers: { display_name: string };
    order_lines: Line[];
  }[];

  const soldLines = (o: (typeof orders)[number]) =>
    o.order_lines.filter((l) => l.line_status !== "unavailable" && (l.actual_qty ?? 0) > 0);

  const ordersByLowerName = new Map<string, typeof orders>();
  for (const o of orders) {
    const key = o.customers.display_name.toLowerCase();
    ordersByLowerName.set(key, [...(ordersByLowerName.get(key) ?? []), o]);
  }

  const resolved: { customer: string; cost: number; orders: { orderId: string; soldLineIds: string[] }[]; allSold: string[] }[] = [];
  const unresolved: { customer: string; reason: string }[] = [];
  const matchedOrderIds = new Set<string>();

  for (const line of inputLines) {
    if (!Number.isFinite(line.cost) || line.cost < 0) {
      unresolved.push({ customer: line.customer, reason: `invalid cost ${line.cost}` });
      continue;
    }
    const matches = ordersByLowerName.get(line.customer.trim().toLowerCase());
    if (!matches || matches.length === 0) {
      unresolved.push({ customer: line.customer, reason: "no order delivered this date for this customer" });
      continue;
    }
    // A customer can have >1 OMS order that day (e.g. a single Mover delivery
    // recorded as two orders). Distribute this customer's Mover cost across all
    // their orders' sold lines rather than erroring.
    const perOrderSold = matches.map((o) => ({ orderId: o.id, soldLineIds: soldLines(o).map((l) => l.id) }));
    const allSold = perOrderSold.flatMap((x) => x.soldLineIds);
    if (allSold.length === 0) {
      unresolved.push({ customer: line.customer, reason: "order(s) have no sold lines -- nothing to allocate to" });
      continue;
    }
    matches.forEach((o) => matchedOrderIds.add(o.id));
    resolved.push({ customer: line.customer, cost: line.cost, orders: perOrderSold, allSold });
  }

  // Gurgaon universe = the resolved (Mover-listed) orders. Hub denominator is
  // the sum of their sold items.
  const gurgaonItemCount = resolved.reduce((sum, r) => sum + r.allSold.length, 0);
  if (gurgaonItemCount === 0) {
    console.log("No resolvable Gurgaon orders for this date -- nothing to do.");
    if (unresolved.length > 0) {
      console.log("Unresolved input lines:");
      unresolved.forEach((u) => console.log(`  - "${u.customer}": ${u.reason}`));
    }
    return;
  }
  const hubPerItem = round2(hubCost / gurgaonItemCount);

  // Non-cancelled orders delivered this date that are NOT in the Mover sheet ->
  // treated as non-Gurgaon (no delivery cost). Surface for admin confirmation.
  const notInSheet = orders
    .filter((o) => !matchedOrderIds.has(o.id))
    .map((o) => ({ customer: o.customers.display_name, soldItems: soldLines(o).length }));

  console.log(`Gurgaon orders (from Mover sheet): ${resolved.length}/${inputLines.length} resolved`);
  console.log(`Gurgaon sold items (hub denominator): ${gurgaonItemCount}`);
  console.log(`Hub share per item: ${hubCost} / ${gurgaonItemCount} = ${hubPerItem}\n`);

  if (unresolved.length > 0) {
    console.log("Unresolved Mover lines (need a manual match before these apply):");
    unresolved.forEach((u) => console.log(`  - "${u.customer}": ${u.reason}`));
    console.log("");
  }
  if (notInSheet.length > 0) {
    console.log(`Orders delivered ${entryDate} NOT in the Mover sheet -> treated as non-Gurgaon, no delivery cost (confirm these are Delhi/outside):`);
    notInSheet.forEach((o) => console.log(`  - ${o.customer} (${o.soldItems} sold items)`));
    console.log("");
  }

  let totalLinesUpdated = 0;
  let totalLinesAlreadySet = 0;
  const perOrder: { customer: string; cost: number; perLine: number; updated: number; alreadySet: number }[] = [];
  const lineUpdates: { id: string; cost: number }[] = [];

  const lineById = new Map(orders.flatMap((o) => o.order_lines.map((l) => [l.id, l] as const)));
  for (const item of resolved) {
    const moverShare = item.cost / item.allSold.length;
    const perLine = round2(hubPerItem + moverShare);

    let updated = 0;
    let alreadySet = 0;
    for (const lineId of item.allSold) {
      const l = lineById.get(lineId)!;
      if (l.actual_delivery_cost === null) {
        lineUpdates.push({ id: lineId, cost: perLine });
        updated++;
      } else {
        alreadySet++;
      }
    }
    perOrder.push({ customer: item.customer, cost: item.cost, perLine, updated, alreadySet });
    totalLinesUpdated += updated;
    totalLinesAlreadySet += alreadySet;
  }

  console.log("Per order (hub share + mover share, over sold lines):");
  perOrder.forEach((o) =>
    console.log(`  ${o.customer}: mover ${o.cost} -> ${o.perLine}/line, ${o.updated} to fill, ${o.alreadySet} already set`),
  );
  console.log(`\nTotal: ${totalLinesUpdated} lines to fill, ${totalLinesAlreadySet} already set (untouched)`);

  if (!execute) {
    console.log("\nDry run only -- no writes made. Re-run with --execute to apply.");
    return;
  }

  const { error: hubUpsertError } = await supabase
    .from("daily_delivery_hub_costs")
    .upsert({ entry_date: entryDate, hub_cost: hubCost }, { onConflict: "entry_date" });
  if (hubUpsertError) throw new Error(`Failed upserting daily_delivery_hub_costs: ${hubUpsertError.message}`);

  // Split each customer's Mover cost across their order(s), proportional to sold
  // line count, for the per-order provenance table.
  const orderCostRows = resolved.flatMap((item) =>
    item.orders.map((o) => ({
      order_id: o.orderId,
      delivery_cost: round2((item.cost * o.soldLineIds.length) / item.allSold.length),
    })),
  );
  const { error: orderCostUpsertError } = await supabase
    .from("order_delivery_costs")
    .upsert(orderCostRows, { onConflict: "order_id" });
  if (orderCostUpsertError) throw new Error(`Failed upserting order_delivery_costs: ${orderCostUpsertError.message}`);

  // Group line updates by cost so we can batch the .in() writes.
  const byCost = new Map<number, string[]>();
  for (const u of lineUpdates) byCost.set(u.cost, [...(byCost.get(u.cost) ?? []), u.id]);
  for (const [cost, ids] of byCost) {
    const { error } = await supabase.from("order_lines").update({ actual_delivery_cost: cost }).in("id", ids);
    if (error) throw new Error(`Failed updating order_lines at ${cost}: ${error.message}`);
  }

  console.log(`\nApplied. ${totalLinesUpdated} order_lines filled, ${orderCostRows.length} order_delivery_costs rows, hub cost recorded.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
