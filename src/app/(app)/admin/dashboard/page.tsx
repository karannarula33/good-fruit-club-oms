import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { istWallClockToUtc, utcToIstDatetimeLocal } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { DateNav } from "@/components/ui/date-nav";
import { MonthNav } from "@/components/ui/month-nav";
import { cn } from "@/lib/cn";
import { computeMonthAggregate, withProductNames, type DashboardOrder } from "@/lib/dashboard/compute";
import { TrendChart } from "./trend-chart";

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <p className="font-sans text-xs font-semibold text-muted uppercase tracking-wide">{label}</p>
      <p className="font-display text-2xl font-bold text-foreground">{value}</p>
      {sub && <p className="font-sans text-xs text-muted">{sub}</p>}
    </Card>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ granularity?: string; month?: string; date?: string }>;
}) {
  await requireRole(["admin"]);

  const params = await searchParams;
  const granularity = params.granularity === "day" ? "day" : "month";

  const todayIso = utcToIstDatetimeLocal(new Date()).slice(0, 10);
  const month = params.month ?? (params.date ?? todayIso).slice(0, 7);
  const date = params.date ?? todayIso;

  let rangeStart: string;
  let rangeEnd: string;
  if (granularity === "day") {
    rangeStart = istWallClockToUtc(`${date}T00:00`).toISOString();
    rangeEnd = new Date(new Date(rangeStart).getTime() + 24 * 60 * 60 * 1000).toISOString();
  } else {
    rangeStart = istWallClockToUtc(`${month}-01T00:00`).toISOString();
    const [year, mon] = month.split("-").map(Number);
    const nextMonth = mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, "0")}`;
    rangeEnd = istWallClockToUtc(`${nextMonth}-01T00:00`).toISOString();
  }

  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("orders")
    .select("id, placed_at, customer_id, is_historical, customers(display_name)")
    .gte("placed_at", rangeStart)
    .lt("placed_at", rangeEnd);

  const orderIds = (orders ?? []).map((o) => o.id);

  const [{ data: orderLines }, { data: products }] = await Promise.all([
    orderIds.length
      ? supabase
          .from("order_lines")
          .select("order_id, product_id, actual_qty, locked_price_per_unit, locked_cogs_per_unit, actual_packaging_cost, actual_delivery_cost")
          .in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
    supabase.from("products").select("id, name"),
  ]);

  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));
  const linesByOrderId = new Map<string, typeof orderLines>();
  for (const line of orderLines ?? []) {
    const list = linesByOrderId.get(line.order_id) ?? [];
    list.push(line);
    linesByOrderId.set(line.order_id, list as NonNullable<typeof orderLines>);
  }

  const dashboardOrders: DashboardOrder[] = (orders ?? []).map((order) => ({
    id: order.id,
    placedAtIso: order.placed_at,
    customerId: order.customer_id,
    customerName: (order.customers as unknown as { display_name: string } | null)?.display_name ?? "Unknown customer",
    isHistorical: order.is_historical,
    lines: (linesByOrderId.get(order.id) ?? []).map((line) => ({
      productId: line.product_id,
      actualQty: line.actual_qty,
      lockedPricePerUnit: line.locked_price_per_unit,
      lockedCogsPerUnit: line.locked_cogs_per_unit,
      actualPackagingCost: line.actual_packaging_cost,
      actualDeliveryCost: line.actual_delivery_cost,
    })),
  }));

  const agg = computeMonthAggregate(dashboardOrders);
  const topProducts = withProductNames(agg.topProducts, productNameById);

  return (
    <div className="flex flex-col gap-5 px-[18px] pt-5 pb-6">
      <PageHeader
        title="Dashboard"
        subtitle={`${agg.orderCount} order${agg.orderCount === 1 ? "" : "s"}${agg.historicalOrderCount > 0 ? ` · ${agg.historicalOrderCount} pre-OMS backfilled` : ""}`}
        action={
          <div className="flex items-center gap-3">
            <div className="flex rounded-md border border-neutral-300 overflow-hidden text-sm font-sans font-semibold">
              <Link
                href={`/admin/dashboard?granularity=day&date=${date}`}
                className={cn("px-3 py-1", granularity === "day" ? "bg-brand text-brand-foreground" : "text-muted")}
              >
                Day
              </Link>
              <Link
                href={`/admin/dashboard?granularity=month&month=${month}`}
                className={cn("px-3 py-1", granularity === "month" ? "bg-brand text-brand-foreground" : "text-muted")}
              >
                Month
              </Link>
            </div>
            {granularity === "day" ? (
              <DateNav date={date} basePath="/admin/dashboard" />
            ) : (
              <MonthNav month={month} basePath="/admin/dashboard" />
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Revenue" value={formatRupees(agg.revenue)} />
        <StatTile label="COGS" value={formatRupees(agg.cogs)} sub={`${agg.cogsCoveragePct.toFixed(0)}% of lines costed`} />
        <StatTile label="Packaging + delivery" value={formatRupees(agg.packagingCost + agg.deliveryCost)} sub={`${Math.min(agg.packagingCoveragePct, agg.deliveryCoveragePct).toFixed(0)}% of lines costed`} />
        <StatTile
          label="Gross margin"
          value={formatRupees(agg.grossMargin)}
          sub={agg.grossMarginPct !== null ? `${agg.grossMarginPct.toFixed(1)}% of revenue` : undefined}
        />
        <StatTile label="Orders" value={String(agg.orderCount)} />
        <StatTile label="Order lines" value={String(agg.lineCount)} />
      </div>

      {granularity === "month" && (
        <Card elevated>
          <p className="font-sans text-sm font-bold text-foreground px-1 pt-1">Revenue &amp; margin by day</p>
          <TrendChart daily={agg.daily} />
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card elevated>
          <p className="font-sans text-sm font-bold text-foreground px-1 pt-1">Top products by revenue</p>
          <table className="w-full text-sm">
            <tbody>
              {topProducts.map((p) => (
                <tr key={p.id} className="border-t border-neutral-bg">
                  <td className="py-1.5 px-1 font-sans text-foreground">{p.name}</td>
                  <td className="py-1.5 px-1 font-sans text-right text-muted">{formatRupees(p.revenue)}</td>
                </tr>
              ))}
              {topProducts.length === 0 && (
                <tr>
                  <td className="py-3 px-1 font-sans text-sm text-muted text-center" colSpan={2}>No data yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card elevated>
          <p className="font-sans text-sm font-bold text-foreground px-1 pt-1">Top customers by spend</p>
          <table className="w-full text-sm">
            <tbody>
              {agg.topCustomers.map((c) => (
                <tr key={c.id} className="border-t border-neutral-bg">
                  <td className="py-1.5 px-1 font-sans text-foreground">{c.name}</td>
                  <td className="py-1.5 px-1 font-sans text-right text-muted">{formatRupees(c.revenue)}</td>
                </tr>
              ))}
              {agg.topCustomers.length === 0 && (
                <tr>
                  <td className="py-3 px-1 font-sans text-sm text-muted text-center" colSpan={2}>No data yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
