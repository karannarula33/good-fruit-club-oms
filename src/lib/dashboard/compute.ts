// Revenue/cost/margin aggregation for the admin Dashboard. Reuses the
// app's actual billing formula (roundLineAmount) rather than inventing a
// second definition of revenue -- see src/lib/billing/compute.ts.
//
// Historical orders (CLAUDE.md's is_historical) are included in revenue
// the same as live orders: that flag exists to exclude pre-OMS data from
// financial records (bills/ledger), not from reporting -- the backfill's
// whole point was a complete picture. Cost data completeness varies
// though (COGS/packaging/delivery cost are still rolling out), so
// coverage is tracked and surfaced per cost type rather than silently
// treated as zero.

import { roundLineAmount, roundToCents } from "@/lib/billing/compute";

export interface DashboardLine {
  productId: string | null;
  actualQty: number | null;
  lockedPricePerUnit: number | null;
  lockedCogsPerUnit: number | null;
  actualPackagingCost: number | null;
  actualDeliveryCost: number | null;
}

export interface DashboardOrder {
  id: string;
  placedAtIso: string;
  customerId: string;
  customerName: string;
  isHistorical: boolean;
  lines: DashboardLine[];
}

export interface NamedTotal {
  id: string;
  name: string;
  revenue: number;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD, IST calendar day
  revenue: number;
  margin: number;
}

export interface MonthAggregate {
  revenue: number;
  cogs: number;
  packagingCost: number;
  deliveryCost: number;
  totalCost: number;
  grossMargin: number;
  grossMarginPct: number | null;
  orderCount: number;
  historicalOrderCount: number;
  lineCount: number;
  cogsCoveragePct: number;
  packagingCoveragePct: number;
  deliveryCoveragePct: number;
  daily: DailyPoint[];
  topProducts: NamedTotal[];
  topCustomers: NamedTotal[];
}

function lineRevenue(line: DashboardLine): number {
  if (line.actualQty === null || line.lockedPricePerUnit === null) return 0;
  return roundLineAmount(line.actualQty, line.lockedPricePerUnit);
}

function lineCogs(line: DashboardLine): number {
  if (line.actualQty === null || line.lockedCogsPerUnit === null) return 0;
  return roundToCents(line.actualQty * line.lockedCogsPerUnit);
}

// Converts a UTC ISO timestamp to its IST calendar day (YYYY-MM-DD).
function istCalendarDay(isoUtc: string): string {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
  const shifted = new Date(new Date(isoUtc).getTime() + IST_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

export function computeMonthAggregate(orders: DashboardOrder[]): MonthAggregate {
  let revenue = 0;
  let cogs = 0;
  let packagingCost = 0;
  let deliveryCost = 0;
  let lineCount = 0;
  let cogsCounted = 0;
  let packagingCounted = 0;
  let deliveryCounted = 0;
  let historicalOrderCount = 0;

  const dailyMap = new Map<string, { revenue: number; margin: number }>();
  const productTotals = new Map<string, { name: string; revenue: number }>();
  const customerTotals = new Map<string, { name: string; revenue: number }>();

  for (const order of orders) {
    if (order.isHistorical) historicalOrderCount += 1;
    const day = istCalendarDay(order.placedAtIso);
    let orderRevenue = 0;
    let orderMargin = 0;

    for (const line of order.lines) {
      lineCount += 1;
      const rev = lineRevenue(line);
      revenue += rev;
      orderRevenue += rev;

      let lineCost = 0;
      if (line.lockedCogsPerUnit !== null) {
        cogsCounted += 1;
        const c = lineCogs(line);
        cogs += c;
        lineCost += c;
      }
      if (line.actualPackagingCost !== null) {
        packagingCounted += 1;
        packagingCost += line.actualPackagingCost;
        lineCost += line.actualPackagingCost;
      }
      if (line.actualDeliveryCost !== null) {
        deliveryCounted += 1;
        deliveryCost += line.actualDeliveryCost;
        lineCost += line.actualDeliveryCost;
      }
      orderMargin += rev - lineCost;

      if (line.productId) {
        const existing = productTotals.get(line.productId);
        productTotals.set(line.productId, { name: existing?.name ?? line.productId, revenue: (existing?.revenue ?? 0) + rev });
      }
    }

    const dayEntry = dailyMap.get(day) ?? { revenue: 0, margin: 0 };
    dayEntry.revenue += orderRevenue;
    dayEntry.margin += orderMargin;
    dailyMap.set(day, dayEntry);

    const custEntry = customerTotals.get(order.customerId);
    customerTotals.set(order.customerId, { name: order.customerName, revenue: (custEntry?.revenue ?? 0) + orderRevenue });
  }

  const totalCost = roundToCents(cogs + packagingCost + deliveryCost);
  const grossMargin = roundToCents(revenue - totalCost);

  return {
    revenue: roundToCents(revenue),
    cogs: roundToCents(cogs),
    packagingCost: roundToCents(packagingCost),
    deliveryCost: roundToCents(deliveryCost),
    totalCost,
    grossMargin,
    grossMarginPct: revenue > 0 ? roundToCents((grossMargin / revenue) * 100) : null,
    orderCount: orders.length,
    historicalOrderCount,
    lineCount,
    cogsCoveragePct: lineCount > 0 ? roundToCents((cogsCounted / lineCount) * 100) : 0,
    packagingCoveragePct: lineCount > 0 ? roundToCents((packagingCounted / lineCount) * 100) : 0,
    deliveryCoveragePct: lineCount > 0 ? roundToCents((deliveryCounted / lineCount) * 100) : 0,
    daily: [...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
    topProducts: [...productTotals.entries()]
      .map(([id, v]) => ({ id, name: v.name, revenue: roundToCents(v.revenue) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10),
    topCustomers: [...customerTotals.entries()]
      .map(([id, v]) => ({ id, name: v.name, revenue: roundToCents(v.revenue) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10),
  };
}

// Resolves product display names into topProducts after aggregation,
// since the aggregator only sees product_id (keeps computeMonthAggregate
// free of a name-lookup dependency, easier to unit test in isolation).
export function withProductNames(topProducts: NamedTotal[], productNameById: Map<string, string>): NamedTotal[] {
  return topProducts.map((p) => ({ ...p, name: productNameById.get(p.id) ?? p.name }));
}
