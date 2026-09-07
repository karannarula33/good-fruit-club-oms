// Daily order -> Google Sheets sync, feeding the "Orders" tab of the
// business's hand-maintained Master Dashboard sheet. Syncs orders whose delivery_date was
// TARGET_DAYS_AGO days ago (not "yesterday") -- by then whether an order
// was actually paid cash (needed for the COD fee) is normally known, since
// "Skip (pay later)" at delivery means it isn't knowable on delivery day
// itself (src/app/actions/delivery.ts). Append-only: each order is synced
// exactly once, tracked via order_sheet_sync (0026).
//
// Writes only the columns the OMS can actually compute: Date, #, Customer,
// Phone, Address, Fruit, Qty, Size, Sell Price, Pkg Cost (actual), Delivery
// (actual). COGS/Gross Profit/Net Profit/Notes and the legacy "Filled"/
// Flat Fee/formula columns are left blank -- COGS isn't tracked anywhere in
// the OMS, and the rest belonged to the old manual process this replaces.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PackagingType } from "@/lib/supabase/database.types";
import { buildDeliveryPricingConfig } from "@/lib/delivery/config";
import { computePackagingCost } from "@/lib/delivery/packaging-cost";
import { computeDeliveryCost } from "@/lib/delivery/delivery-cost";
import { splitCostAcrossLines } from "@/lib/delivery/split-cost";
import { resolveCustomerDistanceKm } from "@/lib/delivery/distance-cache";
import { packagesUsedByOrder } from "@/lib/packing/packaging";
import { IST_OFFSET_MINUTES } from "@/lib/time/ist";
import type { SheetsClient } from "@/lib/google/sheets-client";

type Client = SupabaseClient<Database>;

const TARGET_DAYS_AGO = 2;

export interface SheetSyncDeps {
  sheetsClient: SheetsClient;
  sheetTabName: string;
  getDrivingDistanceKm: (origin: string, destination: string) => Promise<number | null>;
  // When true, computes and reports what would be synced but never calls
  // appendRows or inserts order_sheet_sync markers -- used by
  // scripts/sync-orders-to-sheet.ts's default dry run. Without this, a
  // no-op fake sheetsClient would still cause real orders to be marked
  // synced, permanently hiding them from a later real run.
  dryRun?: boolean;
}

export interface SheetSyncSummary {
  targetDeliveryDate: string;
  syncedOrders: number;
  skippedOrders: { orderId: string; reason: string }[];
}

// "Today, IST" minus N days, as a delivery_date-shaped YYYY-MM-DD string.
function targetDeliveryDateIso(now: Date, daysAgo: number): string {
  const istNow = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  istNow.setUTCDate(istNow.getUTCDate() - daysAgo);
  return istNow.toISOString().slice(0, 10);
}

export async function runSheetSync(supabase: Client, deps: SheetSyncDeps): Promise<SheetSyncSummary> {
  const targetDeliveryDate = targetDeliveryDateIso(new Date(), TARGET_DAYS_AGO);

  const [
    { data: numericConfigRows, error: numericConfigError },
    { data: textConfigRows, error: textConfigError },
    { data: rateRows, error: rateError },
    { count: ordersOnDeliveryDate, error: countError },
  ] = await Promise.all([
    supabase.from("delivery_pricing_config").select("key, value"),
    supabase.from("delivery_pricing_text_config").select("key, value"),
    supabase.from("packaging_cost_rates").select("packaging_type, cost_per_unit"),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("delivery_date", targetDeliveryDate)
      .neq("status", "cancelled"),
  ]);
  if (numericConfigError) throw new Error(`Failed to load delivery_pricing_config: ${numericConfigError.message}`);
  if (textConfigError) throw new Error(`Failed to load delivery_pricing_text_config: ${textConfigError.message}`);
  if (rateError) throw new Error(`Failed to load packaging_cost_rates: ${rateError.message}`);
  if (countError) throw new Error(`Failed to count orders for ${targetDeliveryDate}: ${countError.message}`);

  const pricingConfig = buildDeliveryPricingConfig(numericConfigRows ?? [], textConfigRows ?? []);
  const ratePerType = Object.fromEntries(
    (rateRows ?? []).map((r) => [r.packaging_type, r.cost_per_unit]),
  ) as Record<PackagingType, number>;

  // Bounded to a single delivery date -- realistically dozens of orders,
  // never near PostgREST's 1000-row page cap, so a plain .select() (like
  // the date-range-bounded CSV export route) is fine here, unlike the
  // full-table engagement recompute.
  const { data: dayOrders, error: dayOrdersError } = await supabase
    .from("orders")
    .select("id, customer_id")
    .eq("delivery_date", targetDeliveryDate)
    .eq("status", "delivered");
  if (dayOrdersError) throw new Error(`Failed to load orders for ${targetDeliveryDate}: ${dayOrdersError.message}`);

  const allOrderIds = (dayOrders ?? []).map((o) => o.id);
  if (allOrderIds.length === 0) {
    return { targetDeliveryDate, syncedOrders: 0, skippedOrders: [] };
  }

  const { data: alreadySynced, error: syncedError } = await supabase
    .from("order_sheet_sync")
    .select("order_id")
    .in("order_id", allOrderIds);
  if (syncedError) throw new Error(`Failed to load order_sheet_sync: ${syncedError.message}`);
  const syncedSet = new Set((alreadySynced ?? []).map((r) => r.order_id));

  const eligibleOrders = (dayOrders ?? []).filter((o) => !syncedSet.has(o.id));
  if (eligibleOrders.length === 0) {
    return { targetDeliveryDate, syncedOrders: 0, skippedOrders: [] };
  }
  const eligibleOrderIds = eligibleOrders.map((o) => o.id);
  const customerIds = [...new Set(eligibleOrders.map((o) => o.customer_id))];

  const [
    { data: bills, error: billsError },
    { data: customers, error: customersError },
    { data: lineRows, error: linesError },
    { data: packageRows, error: packagesError },
    { data: allocationRows, error: allocationsError },
  ] = await Promise.all([
    supabase.from("bills").select("order_id, total").in("order_id", eligibleOrderIds),
    supabase.from("customers").select("id, display_name, phone, address").in("id", customerIds),
    supabase
      .from("order_lines")
      .select("id, order_id, product_id, actual_qty, locked_price_per_unit, package_id, products(name, unit_type, unit_label)")
      .in("order_id", eligibleOrderIds)
      .eq("line_status", "packed"),
    supabase.from("order_packages").select("id, order_id, packaging_type").in("order_id", eligibleOrderIds),
    supabase.from("payment_allocations").select("order_id, ledger_entry_id").in("order_id", eligibleOrderIds),
  ]);
  if (billsError) throw new Error(`Failed to load bills: ${billsError.message}`);
  if (customersError) throw new Error(`Failed to load customers: ${customersError.message}`);
  if (linesError) throw new Error(`Failed to load order_lines: ${linesError.message}`);
  if (packagesError) throw new Error(`Failed to load order_packages: ${packagesError.message}`);
  if (allocationsError) throw new Error(`Failed to load payment_allocations: ${allocationsError.message}`);

  const ledgerEntryIds = [...new Set((allocationRows ?? []).map((a) => a.ledger_entry_id))];
  const { data: ledgerRows, error: ledgerError } = ledgerEntryIds.length
    ? await supabase.from("ledger_entries").select("id, mode").in("id", ledgerEntryIds)
    : { data: [], error: null };
  if (ledgerError) throw new Error(`Failed to load ledger_entries: ${ledgerError.message}`);
  const modeByLedgerEntryId = new Map((ledgerRows ?? []).map((l) => [l.id, l.mode]));

  const cashPaidOrderIds = new Set(
    (allocationRows ?? [])
      .filter((a) => modeByLedgerEntryId.get(a.ledger_entry_id) === "cash")
      .map((a) => a.order_id),
  );

  const billTotalByOrderId = new Map((bills ?? []).map((b) => [b.order_id, b.total]));
  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));

  type LineRow = {
    id: string;
    order_id: string;
    product_id: string | null;
    actual_qty: number | null;
    locked_price_per_unit: number | null;
    package_id: string | null;
    products: { name: string; unit_type: "weight" | "count"; unit_label: string | null } | null;
  };
  const linesByOrderId = new Map<string, LineRow[]>();
  for (const rawLine of (lineRows ?? []) as unknown as LineRow[]) {
    const bucket = linesByOrderId.get(rawLine.order_id) ?? [];
    bucket.push(rawLine);
    linesByOrderId.set(rawLine.order_id, bucket);
  }

  const packagesUsed = packagesUsedByOrder(
    (lineRows ?? []).map((l) => ({ order_id: l.order_id, package_id: l.package_id })),
    (packageRows ?? []).map((p) => ({ id: p.id, order_id: p.order_id, packaging_type: p.packaging_type as PackagingType })),
  );

  const skippedOrders: { orderId: string; reason: string }[] = [];
  const sheetRows: (string | number)[][] = [];
  const syncedOrderIds: string[] = [];

  let orderNumber = 0;
  for (const order of eligibleOrders) {
    const billTotal = billTotalByOrderId.get(order.id);
    if (billTotal === undefined) {
      skippedOrders.push({ orderId: order.id, reason: "no finalized bill" });
      continue;
    }
    const customer = customerById.get(order.customer_id);
    if (!customer) {
      skippedOrders.push({ orderId: order.id, reason: "customer not found" });
      continue;
    }
    const lines = linesByOrderId.get(order.id) ?? [];
    if (lines.length === 0) {
      skippedOrders.push({ orderId: order.id, reason: "no packed lines" });
      continue;
    }

    const distanceKm = await resolveCustomerDistanceKm(supabase, customer, pricingConfig.hubOrigin, deps.getDrivingDistanceKm);
    if (distanceKm === null) {
      skippedOrders.push({ orderId: order.id, reason: "distance lookup failed" });
      continue;
    }

    const orderWeightKg = lines.reduce(
      (sum, line) => sum + (line.products?.unit_type === "weight" ? (line.actual_qty ?? 0) : 0),
      0,
    );

    const packagingCost = computePackagingCost(
      packagesUsed.get(order.id) ?? [],
      ratePerType,
      pricingConfig.miscCostPerPackage,
    );
    const deliveryCost = computeDeliveryCost({
      hubDailyFee: pricingConfig.hubDailyFee,
      ordersOnDeliveryDate: ordersOnDeliveryDate ?? 0,
      distanceKm,
      baseFee: pricingConfig.baseFee,
      baseKm: pricingConfig.baseKm,
      perKmRate: pricingConfig.perKmRate,
      billTotal,
      isCashPaid: cashPaidOrderIds.has(order.id),
      codFeePct: pricingConfig.codFeePct,
      orderWeightKg,
      weightThresholdKg: pricingConfig.weightThresholdKg,
      perKgRate: pricingConfig.perKgRate,
    });
    const packagingCostPerLine = splitCostAcrossLines(packagingCost, lines.length);
    const deliveryCostPerLine = splitCostAcrossLines(deliveryCost, lines.length);

    orderNumber += 1;
    for (const line of lines) {
      if (line.actual_qty === null || line.locked_price_per_unit === null) continue;
      const sellPrice = Math.round(line.actual_qty * line.locked_price_per_unit * 100) / 100;
      sheetRows.push([
        targetDeliveryDate,
        orderNumber,
        customer.display_name,
        customer.phone ?? "",
        customer.address,
        line.products?.name ?? "Unknown product",
        line.actual_qty,
        line.products?.unit_label ?? "",
        sellPrice,
        "", // COGS -- not tracked by the OMS, left for manual entry
        packagingCostPerLine,
        deliveryCostPerLine,
      ]);
    }
    syncedOrderIds.push(order.id);
  }

  if (sheetRows.length > 0) {
    // In a dry run, deps.sheetsClient is expected to be a no-op/logging
    // stand-in (see scripts/sync-orders-to-sheet.ts) -- it's still "called"
    // for visibility, but order_sheet_sync is never touched, so nothing
    // here is treated as actually synced and a later real run will still
    // pick these orders up.
    await deps.sheetsClient.appendRows(deps.sheetTabName, sheetRows);

    if (!deps.dryRun) {
      const markerRows = syncedOrderIds.map((orderId) => ({ order_id: orderId }));
      const CHUNK = 200;
      for (let i = 0; i < markerRows.length; i += CHUNK) {
        const { error } = await supabase.from("order_sheet_sync").insert(markerRows.slice(i, i + CHUNK));
        if (error) throw new Error(`Failed to record order_sheet_sync chunk ${i}: ${error.message}`);
      }
    }
  }

  return { targetDeliveryDate, syncedOrders: syncedOrderIds.length, skippedOrders };
}
