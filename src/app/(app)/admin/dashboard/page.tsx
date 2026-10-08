import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { loadSnapshot } from "@/lib/dashboard/load";
import {
  breakdowns, clampToToday, resolveRanges, summarize,
  BULK_ORDER_LIMIT, COGS_MOVE_PCT, LOW_MARGIN_PCT, LOW_ORDER_DAY_THRESHOLD, SMALL_ORDER_LIMIT,
  type DateRange, type RangeView, type Summary,
} from "@/lib/dashboard/metrics";
import { TrendChart } from "./trend-chart";
import { RangeControls } from "./range-controls";

// ---------- formatting ----------

const rupees = (v: number | null, digits = 0) =>
  v === null ? "–" : `₹${v.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const pctText = (v: number | null, digits = 1) => (v === null ? "–" : `${v.toFixed(digits)}%`);
const num = (v: number | null, digits = 1) => (v === null ? "–" : v.toFixed(digits));
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const longDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const rangeText = (r: DateRange) => (r.from === r.to ? longDate(r.from) : `${shortDate(r.from)} – ${shortDate(r.to)}`);
const STATUS_LABEL: Record<string, string> = {
  recorded: "Recorded", packed: "Packed", dispatched: "Dispatched", out_for_delivery: "Out for delivery", delivered: "Delivered", undelivered: "Undelivered",
};

// "up" = a rise is good (revenue), "down" = a fall is good (a cost), "none" = neutral.
type Better = "up" | "down" | "none";
type Kind = "money" | "count" | "pct" | "ratio";

function Delta({ cur, prev, kind, better }: { cur: number | null; prev: number | null; kind: Kind; better: Better }) {
  if (cur === null || prev === null) return <span className="text-tertiary">no comparison</span>;
  let text: string;
  let diff: number;
  if (kind === "pct") {
    diff = cur - prev;
    text = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} pts`;
  } else {
    if (prev === 0) return <span className="text-tertiary">new vs 0</span>;
    diff = ((cur - prev) / Math.abs(prev)) * 100;
    text = `${diff >= 0 ? "+" : ""}${diff.toFixed(0)}%`;
  }
  const good = better === "none" || Math.abs(diff) < 0.05 ? null : (diff > 0) === (better === "up");
  return (
    <span className={cn("font-semibold", good === null ? "text-muted" : good ? "text-success-text" : "text-danger-text")}>
      {text}
    </span>
  );
}

function Tile({ label, value, cur, prev, kind, better, hint }: {
  label: string; value: string; cur: number | null; prev: number | null; kind: Kind; better: Better; hint?: string;
}) {
  return (
    <Card>
      <p className="font-sans text-[11px] font-semibold text-muted uppercase tracking-wide">{label}</p>
      <p className="font-display text-xl font-bold text-foreground tabular-nums">{value}</p>
      <p className="font-sans text-xs text-muted tabular-nums">
        <Delta cur={cur} prev={prev} kind={kind} better={better} /> · was {formatPrev(prev, kind)}
      </p>
      {hint && <p className="font-sans text-[11px] text-tertiary">{hint}</p>}
    </Card>
  );
}

function formatPrev(prev: number | null, kind: Kind): string {
  if (prev === null) return "–";
  if (kind === "money") return rupees(prev);
  if (kind === "pct") return pctText(prev);
  if (kind === "ratio") return num(prev);
  return String(Math.round(prev));
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="font-display text-lg font-bold text-foreground">{title}</h2>
        {note && <p className="font-sans text-xs text-muted max-w-[70ch]">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Table({ head, rows, empty = "Nothing in this range.", align }: { head: string[]; rows: React.ReactNode[][]; empty?: string; align?: ("l" | "r")[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm font-sans tabular-nums">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={cn("py-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted whitespace-nowrap", (align?.[i] ?? (i === 0 ? "l" : "r")) === "l" ? "text-left" : "text-right")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-neutral-bg">
              {r.map((c, j) => (
                <td key={j} className={cn("py-1.5 px-2", (align?.[j] ?? (j === 0 ? "l" : "r")) === "l" ? "text-left text-foreground" : "text-right text-foreground")}>{c}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={head.length} className="py-3 px-2 text-center text-muted">{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const grid = "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3";

// ---------- page ----------

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; from?: string; to?: string; month?: string; granularity?: string }>;
}) {
  await requireRole(["admin"]);
  const params = await searchParams;
  const today = utcToIstDatetimeLocal(new Date()).slice(0, 10);

  // Old links (?granularity=day&date= / ?month=) keep working.
  const legacyView = params.granularity === "day" ? "day" : params.month ? "month" : undefined;
  const view: RangeView = (["day", "week", "month", "custom"] as const).find((v) => v === (params.view ?? legacyView)) ?? "month";
  const isoDate = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const anchor = isoDate(params.date) ?? (params.month && /^\d{4}-\d{2}$/.test(params.month) ? `${params.month}-01` : today);

  const resolved = resolveRanges(view, anchor, isoDate(params.from), isoDate(params.to));
  const { current, previous, partial } = clampToToday(resolved, today);

  const supabase = await createClient();
  const snap = await loadSnapshot(supabase);
  const cur = summarize(snap, current);
  const prev = summarize(snap, previous);
  const b = breakdowns(snap, current);

  const t = (label: string, key: keyof Summary, kind: Kind, better: Better, value: string, hint?: string) => (
    <Tile key={label} label={label} value={value} cur={cur[key] as number | null} prev={prev[key] as number | null} kind={kind} better={better} hint={hint} />
  );

  const cov = cur.coverage;
  const gaps = [
    cov.cogs !== null && cov.cogs < 100 ? `COGS on ${cov.cogs.toFixed(0)}% of items` : null,
    cov.packaging !== null && cov.packaging < 100 ? `packing on ${cov.packaging.toFixed(0)}%` : null,
    cov.delivery !== null && cov.delivery < 100 ? `delivery on ${cov.delivery.toFixed(0)}%` : null,
    cov.labour !== null && cov.labour < 100 ? `labour on ${cov.labour.toFixed(0)}%` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6 px-[18px] pt-5 pb-10">
      <PageHeader
        title="Dashboard"
        subtitle={
          <>
            {rangeText(current)} · compared with {rangeText(previous)}
            {partial ? " (same days)" : ""} · by delivery date
          </>
        }
        action={<RangeControls view={view} anchor={anchor} from={current.from} to={current.to} today={today} />}
      />

      {(gaps.length > 0 || !snap.schemaReady) && (
        <div className="rounded-xl bg-warning-bg px-3 py-2 font-sans text-xs text-warning-text">
          {gaps.length > 0 && <>Costs are still being filled for this range: {gaps.join(", ")}. Margins will move as they come in. </>}
          {!snap.schemaReady && <>Run migration 0032 in Supabase to turn on product categories, the internal-account flag and overheads.</>}
        </div>
      )}

      <Section title="Headline">
        <div className={grid}>
          {t("Revenue", "revenue", "money", "up", rupees(cur.revenue))}
          {t("Orders", "orders", "count", "up", String(cur.orders))}
          {t("AOV", "aov", "money", "up", rupees(cur.aov), "Revenue ÷ orders")}
          {t("Gross margin", "grossMarginPct", "pct", "up", pctText(cur.grossMarginPct), "(Revenue – COGS) ÷ revenue")}
          {t("Contribution margin", "contributionPct", "pct", "up", pctText(cur.contributionPct), "After COGS, packing, delivery and labour")}
          {t("Contribution", "contribution", "money", "up", rupees(cur.contribution))}
          {t("Net after overheads", "netAfterOverheads", "money", "up", rupees(cur.netAfterOverheads), `Contribution – ads ${rupees(cur.adSpend)} – day-level costs ${rupees(cur.dayLevelCosts)}`)}
          {t("Revenue per operating day", "revenuePerOperatingDay", "money", "up", rupees(cur.revenuePerOperatingDay), `${cur.operatingDays} day${cur.operatingDays === 1 ? "" : "s"} with orders`)}
        </div>
      </Section>

      <Section title="Costs" note="Packing and delivery are shown separately. Labour is the packer's pay spread across each month's items.">
        <div className={grid}>
          {t("COGS", "cogs", "money", "down", rupees(cur.cogs))}
          {t("Packing", "packaging", "money", "down", rupees(cur.packaging))}
          {t("Delivery", "delivery", "money", "down", rupees(cur.delivery))}
          {t("Labour", "labour", "money", "down", rupees(cur.labour))}
          {t("Delivery % of revenue", "deliveryPctOfRevenue", "pct", "down", pctText(cur.deliveryPctOfRevenue))}
          {t("Ad spend", "adSpend", "money", "down", rupees(cur.adSpend))}
          {t("Day-level costs", "dayLevelCosts", "money", "down", rupees(cur.dayLevelCosts), "COD fees, Mover minimums, other")}
        </div>
        <p className="font-sans text-xs text-muted">
          Ads and day-level costs come from <Link href="/admin/overheads" className="font-semibold text-brand">Overheads</Link>.
        </p>
      </Section>

      <Section title="Per order">
        <div className={grid}>
          {t("Items per order", "itemsPerOrder", "ratio", "up", num(cur.itemsPerOrder))}
          {t("Packing per order", "packagingPerOrder", "money", "down", rupees(cur.packagingPerOrder, 1))}
          {t("Delivery per order", "deliveryPerOrder", "money", "down", rupees(cur.deliveryPerOrder, 1))}
          {t("Labour per order", "labourPerOrder", "money", "down", rupees(cur.labourPerOrder, 1))}
          {t("Contribution per order", "contributionPerOrder", "money", "up", rupees(cur.contributionPerOrder, 1))}
          {t("Break-even order value", "breakEvenOrderValue", "money", "down", rupees(cur.breakEvenOrderValue), "Order value where gross margin just covers packing, delivery and labour")}
        </div>
      </Section>

      <Section title="Order shape">
        <div className={grid}>
          {t("Single-item orders", "singleItemShare", "pct", "down", pctText(cur.singleItemShare))}
          {t(`Orders under ₹${SMALL_ORDER_LIMIT}`, "under500Share", "pct", "down", `${cur.under500Count} · ${pctText(cur.under500Share)}`)}
          {t("Gift & bulk orders", "giftBulkShare", "pct", "up", `${cur.giftBulkCount} · ${pctText(cur.giftBulkShare)}`, `Gift-box line or ₹${BULK_ORDER_LIMIT.toLocaleString("en-IN")}+`)}
          {t(`Days under ${LOW_ORDER_DAY_THRESHOLD} orders`, "lowOrderDays", "count", "down", String(cur.lowOrderDays), "Target: zero")}
          {t("Unavailable rate", "unavailableRate", "pct", "down", pctText(cur.unavailableRate), "Unsold lines ÷ all lines")}
          {t("Substitution rate", "substitutionRate", "pct", "down", pctText(cur.substitutionRate))}
        </div>
      </Section>

      <Section title="Replacements and free items" note="Items charged ₹1 or less. Most are free replacements for poor-quality items, and the original usually isn't collected back, so their cost is already inside COGS and the margins above. Atta samples and gift cards or diyas are counted as free extras.">
        <div className={grid}>
          {t("Replacement items", "replacementCount", "count", "down", String(cur.replacementCount), `${cur.replacementOrders} order${cur.replacementOrders === 1 ? "" : "s"}`)}
          {t("Orders with a replacement", "replacementOrderShare", "pct", "down", pctText(cur.replacementOrderShare))}
          {t("Replacement cost", "replacementCost", "money", "down", rupees(cur.replacementCost))}
          {t("Replacement cost % of revenue", "replacementCostPct", "pct", "down", pctText(cur.replacementCostPct, 2))}
          {t("Free extras", "freebieCost", "money", "none", rupees(cur.freebieCost), `${cur.freebieCount} item${cur.freebieCount === 1 ? "" : "s"}: atta samples, gift cards, diyas`)}
        </div>
      </Section>

      {b.daily.length > 1 && (
        <Card elevated>
          <p className="font-sans text-sm font-bold text-foreground px-1 pt-1">Revenue &amp; gross margin by day</p>
          <TrendChart daily={b.daily.map((d) => ({ date: d.date, revenue: d.revenue, margin: d.grossMargin }))} />
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="By week" note="Week 1 starts Tue 2 June. All weeks up to the end of the selected range.">
          <Card>
            <Table
              head={["Week", "Starts", "Orders", "Revenue", "AOV"]}
              rows={[...b.weekly].reverse().map((w) => [`Week ${w.week}`, shortDate(w.start), w.orders, rupees(w.revenue), rupees(w.aov)])}
            />
          </Card>
        </Section>
        <div className="flex flex-col gap-4">
          <Section title="Day-of-week mix">
            <Card>
              <Table
                head={["Day", "Orders", "Share", "Revenue", "Share"]}
                rows={b.weekdays.map((w) => [w.day, w.orders, pctText(w.orderShare, 0), rupees(w.revenue), pctText(w.revenueShare, 0)])}
              />
            </Card>
          </Section>
          <Section title="Order status" note="Where this range's orders stand now.">
            <Card>
              <Table head={["Status", "Orders"]} rows={b.statusMix.map((s) => [STATUS_LABEL[s.status] ?? s.status, s.orders])} />
            </Card>
          </Section>
          {b.lowOrderDays.length > 0 && (
            <Section title={`Days under ${LOW_ORDER_DAY_THRESHOLD} orders`}>
              <Card>
                <Table head={["Date", "Orders"]} rows={b.lowOrderDays.map((d) => [longDate(d.date), d.orders])} />
              </Card>
            </Section>
          )}
        </div>
      </div>

      <Section title="Members" note="Lifetime figures are as of the last day of the range.">
        <div className={grid}>
          {t("Active members", "activeMembers", "count", "up", String(cur.activeMembers), "Ordered in the last 14 days")}
          {t("New members", "newMembers", "count", "up", String(cur.newMembers), "First order in this range")}
          {t("Reactivated", "reactivatedMembers", "count", "up", String(cur.reactivatedMembers), "Ordered after 30+ days away")}
          {t("Retention", "retention", "pct", "up", pctText(cur.retention), "Last period's members who ordered again")}
          {t("Second order in 14 days", "secondOrderRate14", "pct", "up", pctText(cur.secondOrderRate14), "Of new members with 14+ days to do it")}
          {t("Third-order rate", "thirdOrderRate", "pct", "up", pctText(cur.thirdOrderRate), "Of members with 2 orders, share with 3+")}
          {t("Repeat rate", "repeatRate", "pct", "up", pctText(cur.repeatRate), "Members with 2+ orders")}
          {t("Lifetime value", "ltvAverage", "money", "up", `${rupees(cur.ltvAverage)} avg`, `Median ${rupees(cur.ltvMedian)}`)}
          {t("Top-10 share of revenue", "top10Share", "pct", "none", pctText(cur.top10Share))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <p className="font-sans text-sm font-bold text-foreground px-2 pt-1">Status mix</p>
            <Table
              head={["Status", "Members", "Lifetime revenue"]}
              rows={b.memberStatus.map((s) => [`${s.status} ${s.status === "Active" ? "(≤14 days)" : s.status === "Cooling" ? "(15–30)" : "(31+)"}`, s.members, rupees(s.lifetimeRevenue)])}
            />
          </Card>
          <Card>
            <p className="font-sans text-sm font-bold text-foreground px-2 pt-1">Cohorts by first-order month</p>
            <Table
              head={["Month", "Members", "Returned", "3+ orders", "LTV", "Active"]}
              rows={b.cohorts.map((c) => [c.month, c.members, pctText(c.returnedPct, 0), pctText(c.threePlusPct, 0), rupees(c.ltv), pctText(c.activePct, 0)])}
            />
          </Card>
        </div>
        <Card>
          <p className="font-sans text-sm font-bold text-foreground px-2 pt-1">Quiet past their normal gap ({b.quietMembers.length})</p>
          <p className="font-sans text-xs text-muted px-2">Days since last order is more than twice their usual gap. Highest lifetime value first.</p>
          <Table
            head={["Member", "Zone", "Last order", "Days quiet", "Usual gap", "Orders", "Lifetime"]}
            align={["l", "l", "r", "r", "r", "r", "r"]}
            rows={b.quietMembers.slice(0, 40).map((q) => [q.name, q.zone, shortDate(q.lastOrder), q.daysSince, `${q.usualGap} d`, q.orders, rupees(q.lifetimeRevenue)])}
            empty="Nobody is overdue."
          />
        </Card>
      </Section>

      <Section title="Products">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <p className="font-sans text-sm font-bold text-foreground px-2 pt-1">Revenue and margin by product</p>
            <Table
              head={["Product", "Revenue", "GM%", "Members", "Unavailable"]}
              rows={b.products.slice(0, 30).map((p) => [
                p.name,
                rupees(p.revenue),
                <span key="gm" className={cn(p.grossMarginPct !== null && p.grossMarginPct < LOW_MARGIN_PCT && "font-semibold text-danger-text")}>{pctText(p.grossMarginPct, 0)}</span>,
                p.customers,
                p.unavailableLines || "",
              ])}
            />
          </Card>
          <div className="flex flex-col gap-4">
            <Card>
              <p className="font-sans text-sm font-bold text-foreground px-2 pt-1">Category mix</p>
              <Table head={["Category", "Revenue", "Share", "GM%"]} rows={b.categories.map((c) => [c.category, rupees(c.revenue), pctText(c.share, 0), pctText(c.grossMarginPct, 0)])} />
            </Card>
            <Card>
              <p className="font-sans text-sm font-bold text-foreground px-2 pt-1">Below {LOW_MARGIN_PCT}% gross margin</p>
              <Table head={["Product", "Revenue", "GM%"]} rows={b.lowMarginProducts.map((p) => [p.name, rupees(p.revenue), pctText(p.grossMarginPct, 0)])} empty="None." />
            </Card>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <p className="font-sans text-sm font-bold text-foreground px-2 pt-1">COGS change vs last week</p>
            <p className="font-sans text-xs text-muted px-2">Average cost per unit, last 7 days of the range vs the 7 before. Moves over {COGS_MOVE_PCT}% flagged.</p>
            <Table
              head={["Product", "Week before", "Last 7 days", "Change"]}
              rows={b.cogsMoves.map((m) => [
                m.name, rupees(m.lastWeek, 0), rupees(m.thisWeek, 0),
                <span key="c" className={cn(Math.abs(m.changePct) > COGS_MOVE_PCT && "font-semibold text-danger-text")}>{`${m.changePct >= 0 ? "+" : ""}${m.changePct.toFixed(0)}%`}</span>,
              ])}
              empty="Not enough cost data in both weeks."
            />
          </Card>
          <Card>
            <p className="font-sans text-sm font-bold text-foreground px-2 pt-1">Given free ({b.freeItems.length})</p>
            <Table
              head={["Date", "Product", "Member", "Qty", "Cost", "Type"]}
              align={["l", "l", "l", "r", "r", "l"]}
              rows={b.freeItems.slice(0, 30).map((x) => [shortDate(x.date), x.product, x.customer, num(x.qty, 2), rupees(x.cost), x.kind === "replacement" ? "Replacement" : "Free extra"])}
              empty="Nothing given free in this range."
            />
          </Card>
          <Card>
            <p className="font-sans text-sm font-bold text-foreground px-2 pt-1">Sold at or below cost ({b.priceExceptions.length})</p>
            <p className="font-sans text-xs text-muted px-2">Charged items only; free replacements are listed separately.</p>
            <Table
              head={["Date", "Product", "Member", "Price", "COGS"]}
              align={["l", "l", "l", "r", "r"]}
              rows={b.priceExceptions.slice(0, 30).map((x) => [shortDate(x.date), x.product, x.customer, rupees(x.price), rupees(x.cogs)])}
              empty="None. Every item sold above cost."
            />
          </Card>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <p className="font-sans text-sm font-bold text-foreground px-2 pt-1">Top product pairings</p>
            <Table head={["Bought together", "Orders"]} rows={b.pairings.map((p) => [`${p.a} + ${p.b}`, p.orders])} />
          </Card>
          <Card>
            <p className="font-sans text-sm font-bold text-foreground px-2 pt-1">Unavailable by product</p>
            <Table head={["Product", "Lines"]} rows={b.unavailableByProduct.map((u) => [u.name, u.count])} empty="Nothing marked unavailable." />
          </Card>
        </div>
      </Section>

      <Section title="Zones" note={`${b.unassignedOrders} order${b.unassignedOrders === 1 ? "" : "s"} in this range belong to members with no zone set.`}>
        <Card>
          <Table
            head={["Zone", "Members", "Orders", "Revenue", "AOV", "Orders / member", "Delivery / order", "Delivery %", "Contribution %", "New"]}
            rows={b.zones.map((z) => [z.zone, z.members, z.orders, rupees(z.revenue), rupees(z.aov), num(z.ordersPerMember), rupees(z.deliveryPerOrder), pctText(z.deliveryPct), pctText(z.contributionPct), z.newMembers])}
          />
        </Card>
      </Section>
    </div>
  );
}
