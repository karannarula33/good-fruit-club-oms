// Daily insights for the dashboard: a short, ranked list of what stands out on
// one delivery day, compared with that business's own recent history. Pure
// rules over the same snapshot as metrics.ts, so the list updates whenever the
// data does (an order recorded, a bill finalised, a COGS slip applied).
//
// Each insight is one of:
//   act   -- something to fix or do today (a ₹1 price, an order never
//            packed, a missing cost, a valuable member gone quiet)
//   watch -- worse than usual, worth a look (revenue down vs a usual Thursday,
//            margin dip, items unavailable, replacements)
//   good  -- better than usual (revenue up, new members, second orders)
//   info  -- context (top sellers, tomorrow's book so far, month pace)

import {
  addDays, breakdowns, countableOrders, daysBetween, freeKind, isPlaceholderPrice, orderEconomics, summarize, weekdayIndex,
  LOW_MARGIN_MIN_REVENUE, LOW_ORDER_DAY_THRESHOLD,
  type MOrder, type Snapshot,
} from "./metrics";

export type InsightTone = "act" | "watch" | "good" | "info";

export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  detail?: string;
  href?: string;
}

// Thresholds. A move has to be at least this big before it is called out.
export const REVENUE_SWING_PCT = 20;
export const AOV_SWING_PCT = 15;
export const MARGIN_DIP_PTS = 5;
export const DELIVERY_COST_SWING_PCT = 25;
export const MONTH_PACE_SWING_PCT = 10;
export const COGS_MOVE_ALERT_PCT = 15;
export const COST_GRACE_DAYS = 2; // COGS/delivery costs usually land within 2 days
export const WIN_BACK_MIN_LIFETIME = 3000;
export const WIN_BACK_SHOWN = 3;
export const BASELINE_DAYS = 28;

const TONE_RANK: Record<InsightTone, number> = { act: 0, watch: 1, good: 2, info: 3 };
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const rs = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const pctChange = (cur: number, base: number) => ((cur - base) / base) * 100;
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listNames = (names: string[], max = 3) =>
  names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} and ${names.length - max} more`;

function dayTotals(orders: MOrder[]): Map<string, { orders: number; revenue: number }> {
  const m = new Map<string, { orders: number; revenue: number }>();
  for (const o of orders) {
    const d = m.get(o.deliveryDate) ?? { orders: 0, revenue: 0 };
    d.orders++;
    d.revenue += orderEconomics(o).revenue;
    m.set(o.deliveryDate, d);
  }
  return m;
}

/**
 * Insights for one delivery day.
 * @param day   the delivery date to explain (YYYY-MM-DD)
 * @param today today's date in IST; used for "tomorrow's book", stuck orders and cost grace periods
 */
export function dailyInsights(snap: Snapshot, day: string, today: string): Insight[] {
  const out: Insight[] = [];
  const all = countableOrders(snap);
  const totals = dayTotals(all);
  const productName = new Map(snap.products.map((p) => [p.id, p.name]));
  const customerName = new Map(snap.customers.map((c) => [c.id, c.name]));
  const pname = (id: string | null) => (id && productName.get(id)) || "Unknown product";
  const dayOrders = all.filter((o) => o.deliveryDate === day);
  const dayName = DAY_NAMES[weekdayIndex(day)];
  const isToday = day === today;
  const isFuture = day > today;

  const s = summarize(snap, { from: day, to: day });
  const baseRange = { from: addDays(day, -BASELINE_DAYS), to: addDays(day, -1) };
  const base = summarize(snap, baseRange);

  // ---- volume vs a usual same weekday ----
  const sameWeekdays = [1, 2, 3, 4].map((w) => totals.get(addDays(day, -7 * w))).filter((x): x is { orders: number; revenue: number } => !!x);
  if (dayOrders.length === 0) {
    if (!isFuture) out.push({ id: "no-orders", tone: "watch", title: `No orders delivered on ${shortDate(day)}` });
  } else if (sameWeekdays.length >= 2 && !isFuture) {
    const avgRev = sameWeekdays.reduce((t, x) => t + x.revenue, 0) / sameWeekdays.length;
    const avgOrders = sameWeekdays.reduce((t, x) => t + x.orders, 0) / sameWeekdays.length;
    const change = avgRev > 0 ? pctChange(s.revenue, avgRev) : 0;
    const detail = `${plural(s.orders, "order")} vs ${avgOrders.toFixed(1)} on a usual ${dayName} (last ${sameWeekdays.length}), revenue ${rs(s.revenue)} vs ${rs(avgRev)}.`;
    if (change >= REVENUE_SWING_PCT) out.push({ id: "revenue-weekday", tone: "good", title: `Revenue ${signed(change)} vs a usual ${dayName}`, detail });
    else if (change <= -REVENUE_SWING_PCT) out.push({ id: "revenue-weekday", tone: "watch", title: `Revenue ${signed(change)} vs a usual ${dayName}`, detail });
    else out.push({ id: "revenue-weekday", tone: "info", title: `A normal ${dayName}: ${rs(s.revenue)} from ${plural(s.orders, "order")}`, detail });
  }

  if (dayOrders.length > 0 && dayOrders.length < LOW_ORDER_DAY_THRESHOLD && !isFuture) {
    out.push({ id: "low-day", tone: "watch", title: `Only ${plural(dayOrders.length, "order")} on ${shortDate(day)}`, detail: `Below the ${LOW_ORDER_DAY_THRESHOLD}-order floor. A broadcast or a nudge to cooling members helps fill a slow day.` });
  }

  // ---- order value ----
  if (s.aov !== null && base.aov !== null && s.orders >= 3) {
    const change = pctChange(s.aov, base.aov);
    if (Math.abs(change) >= AOV_SWING_PCT) {
      out.push({
        id: "aov", tone: change > 0 ? "good" : "watch",
        title: `Average order ${rs(s.aov)}, ${signed(change)} vs the last ${BASELINE_DAYS} days`,
        detail: `Usual is ${rs(base.aov)}. ${s.singleItemShare !== null ? `${s.singleItemShare.toFixed(0)}% of the day's orders were a single item.` : ""}`.trim(),
      });
    }
  }

  // ---- what sold ----
  const b = breakdowns(snap, { from: day, to: day });
  const top = b.products.filter((p) => p.revenue > 0).slice(0, 3);
  if (top.length > 0 && s.revenue > 0) {
    const share = (top.reduce((t, p) => t + p.revenue, 0) / s.revenue) * 100;
    out.push({
      id: "top-sellers", tone: "info",
      title: `Top sellers: ${top.map((p) => p.name).join(", ")}`,
      detail: `${top.map((p) => `${p.name} ${rs(p.revenue)}`).join(" · ")}. Together ${share.toFixed(0)}% of the day's revenue.`,
    });
  }

  // ---- margin (only once the day's COGS are mostly in) ----
  const cogsCov = s.coverage.cogs;
  const daysOld = daysBetween(day, today);
  if (cogsCov !== null && cogsCov < 100 && daysOld >= COST_GRACE_DAYS) {
    out.push({ id: "cogs-missing-day", tone: "act", title: `COGS missing on ${(100 - cogsCov).toFixed(0)}% of ${shortDate(day)}'s items`, detail: "Apply the purchase slip so this day's margin is real." });
  }
  if (cogsCov !== null && cogsCov >= 90 && s.grossMarginPct !== null && base.grossMarginPct !== null) {
    const diff = s.grossMarginPct - base.grossMarginPct;
    if (diff <= -MARGIN_DIP_PTS) {
      const drag = b.products
        .filter((p) => p.grossMarginPct !== null && p.revenue >= LOW_MARGIN_MIN_REVENUE)
        .sort((x, y) => (x.grossMarginPct ?? 0) - (y.grossMarginPct ?? 0))
        .slice(0, 2);
      out.push({
        id: "margin-dip", tone: "watch",
        title: `Gross margin ${s.grossMarginPct.toFixed(1)}%, ${diff.toFixed(1)} pts below usual`,
        detail: `Last ${BASELINE_DAYS} days: ${base.grossMarginPct.toFixed(1)}%.${drag.length ? ` Lowest: ${drag.map((p) => `${p.name} ${p.grossMarginPct!.toFixed(0)}%`).join(", ")}.` : ""}`,
      });
    } else if (diff >= MARGIN_DIP_PTS) {
      out.push({ id: "margin-up", tone: "good", title: `Gross margin ${s.grossMarginPct.toFixed(1)}%, +${diff.toFixed(1)} pts vs usual`, detail: `Last ${BASELINE_DAYS} days: ${base.grossMarginPct.toFixed(1)}%.` });
    }
  }

  if (b.priceExceptions.length > 0) {
    const names = [...new Set(b.priceExceptions.map((x) => x.product))];
    out.push({ id: "below-cost", tone: "act", title: `${plural(b.priceExceptions.length, "item")} sold at or below cost`, detail: `${listNames(names)}. Check the price list or the COGS entered.` });
  }

  // ---- delivery cost per order ----
  if (s.coverage.delivery !== null && s.coverage.delivery >= 90 && s.deliveryPerOrder !== null && base.deliveryPerOrder !== null && base.deliveryPerOrder > 0) {
    const change = pctChange(s.deliveryPerOrder, base.deliveryPerOrder);
    if (change >= DELIVERY_COST_SWING_PCT) {
      out.push({ id: "delivery-cost", tone: "watch", title: `Delivery ${rs(s.deliveryPerOrder)} per order, ${signed(change)} vs usual`, detail: `Usual is ${rs(base.deliveryPerOrder)}. A thin day spreads the hub cost over fewer orders.` });
    }
  }

  // ---- quality: unavailable and replacements ----
  const unavailable = new Map<string, number>();
  const replaced: string[] = [];
  let replacementCost = 0;
  for (const o of dayOrders) {
    for (const l of o.lines) {
      const name = pname(l.productId);
      if (l.lineStatus === "unavailable") unavailable.set(name, (unavailable.get(name) ?? 0) + 1);
      if (freeKind(l, name) === "replacement") {
        replaced.push(`${name} for ${customerName.get(o.customerId) ?? "a member"}`);
        replacementCost += (l.actualQty ?? 0) * (l.cogsPerUnit ?? 0);
      }
    }
  }
  if (unavailable.size > 0) {
    const n = [...unavailable.values()].reduce((t, x) => t + x, 0);
    out.push({
      id: "unavailable", tone: "watch",
      title: `${plural(n, "line")} couldn't be fulfilled`,
      detail: `${listNames([...unavailable].sort((a, z) => z[1] - a[1]).map(([name, c]) => (c > 1 ? `${name} ×${c}` : name)))}. Lost sales; order more of these or take them off the list.`,
    });
  }
  if (replaced.length > 0) {
    out.push({ id: "replacements", tone: "watch", title: `${plural(replaced.length, "free replacement")} sent`, detail: `${listNames(replaced)}. Cost ${rs(replacementCost)}.` });
  }

  // ---- members ----
  const firstOrder = new Map<string, string>();
  const orderDates = new Map<string, string[]>();
  for (const o of all) {
    if (o.deliveryDate > day) continue;
    const f = firstOrder.get(o.customerId);
    if (!f || o.deliveryDate < f) firstOrder.set(o.customerId, o.deliveryDate);
    orderDates.set(o.customerId, [...(orderDates.get(o.customerId) ?? []), o.deliveryDate]);
  }
  const dayMembers = [...new Set(dayOrders.map((o) => o.customerId))];
  const newMembers = dayMembers.filter((c) => firstOrder.get(c) === day);
  if (newMembers.length > 0) {
    out.push({ id: "new-members", tone: "good", title: `${plural(newMembers.length, "new member")}`, detail: `${listNames(newMembers.map((c) => customerName.get(c) ?? "Unknown"))}. A second order inside 14 days is the one to work for.` });
  }
  const secondOrders = dayMembers.filter((c) => {
    const dates = [...new Set(orderDates.get(c) ?? [])].sort();
    return dates.length === 2 && dates[1] === day && daysBetween(dates[0], day) <= 14;
  });
  if (secondOrders.length > 0) {
    out.push({ id: "second-orders", tone: "good", title: `${plural(secondOrders.length, "member")} came back for a second order`, detail: `${listNames(secondOrders.map((c) => customerName.get(c) ?? "Unknown"))}, within 14 days of their first.` });
  }

  const quiet = b.quietMembers.filter((q) => q.lifetimeRevenue >= WIN_BACK_MIN_LIFETIME);
  if (quiet.length > 0) {
    out.push({
      id: "win-back", tone: "act",
      title: `Win back: ${quiet.slice(0, WIN_BACK_SHOWN).map((q) => q.name).join(", ")}`,
      detail: `${quiet.slice(0, WIN_BACK_SHOWN).map((q) => `${q.name} (${rs(q.lifetimeRevenue)} lifetime, quiet ${q.daysSince} days, usually every ${q.usualGap})`).join("; ")}.${quiet.length > WIN_BACK_SHOWN ? ` ${quiet.length - WIN_BACK_SHOWN} more in Members below.` : ""}`,
    });
  }

  // ---- things to fix (always relative to today) ----
  // Past-day orders never packed: either they went out without being packed in
  // the app (so no bill) or they should be cancelled. Later statuses (packed,
  // dispatched, out for delivery) aren't flagged: the team routinely stops at
  // "packed", so that would be noise.
  const unpacked = all.filter((o) => o.deliveryDate < today && o.status === "recorded");
  if (unpacked.length > 0) {
    const oldest = unpacked.map((o) => o.deliveryDate).sort()[0];
    out.push({
      id: "unpacked", tone: "act",
      title: `${plural(unpacked.length, "order")} from earlier days never packed`,
      detail: `${listNames(unpacked.map((o) => `${customerName.get(o.customerId) ?? "Unknown"} (${shortDate(o.deliveryDate)})`))}. Pack and bill them if they went out, or cancel them.`,
      href: `/admin/manage-orders?date=${oldest}`,
    });
  }

  const recent = { from: addDays(today, -30), to: today };
  const placeholders = all.filter((o) => o.deliveryDate >= recent.from && o.deliveryDate <= recent.to)
    .flatMap((o) => o.lines.filter((l) => isPlaceholderPrice(l, pname(l.productId))).map(() => o));
  if (placeholders.length > 0) {
    out.push({ id: "placeholder", tone: "act", title: `${plural(placeholders.length, "item")} billed at exactly ₹1 in the last 30 days`, detail: `${listNames([...new Set(placeholders.map((o) => customerName.get(o.customerId) ?? "Unknown"))])}. Set the real price, or ₹0 if it was a free replacement.` });
  }

  // Costs still missing on days old enough to have them (last 14 days).
  const missing = { cogs: [] as string[], delivery: [] as string[] };
  for (let i = 14; i >= COST_GRACE_DAYS; i--) {
    const d = addDays(today, -i);
    if (!totals.has(d)) continue;
    const cov = summarize(snap, { from: d, to: d }).coverage;
    if (cov.cogs !== null && cov.cogs < 100 && d !== day) missing.cogs.push(d);
    if (cov.delivery !== null && cov.delivery < 100) missing.delivery.push(d);
  }
  if (missing.cogs.length > 0) {
    out.push({ id: "cogs-missing", tone: "act", title: `COGS still missing for ${plural(missing.cogs.length, "day")}`, detail: `${missing.cogs.map(shortDate).join(", ")}. Margins for these days read high until the slips are in.` });
  }
  if (missing.delivery.length > 0) {
    out.push({ id: "delivery-missing", tone: "watch", title: `Delivery costs not in yet for ${plural(missing.delivery.length, "day")}`, detail: `From ${shortDate(missing.delivery[0])}${missing.delivery.length > 1 ? ` to ${shortDate(missing.delivery[missing.delivery.length - 1])}` : ""}. Send the Mover sheets when they arrive.` });
  }

  // Purchase cost moves (last 7 days to `day` vs the 7 before).
  const moves = b.cogsMoves.filter((m) => Math.abs(m.changePct) >= COGS_MOVE_ALERT_PCT).slice(0, 3);
  if (moves.length > 0) {
    const up = moves.filter((m) => m.changePct > 0);
    out.push({
      id: "cogs-moves", tone: up.length > 0 ? "watch" : "good",
      title: `Buying cost moved on ${listNames(moves.map((m) => m.name))}`,
      detail: `${moves.map((m) => `${m.name} ${rs(m.lastWeek)} → ${rs(m.thisWeek)} (${signed(m.changePct)})`).join("; ")}. Last 7 days vs the week before.${up.length > 0 ? " Check the selling price still holds the margin." : ""}`,
    });
  }

  // ---- forward look (only on today) ----
  if (isToday) {
    const tomorrow = addDays(today, 1);
    const booked = all.filter((o) => o.deliveryDate === tomorrow).length;
    const tmrName = DAY_NAMES[weekdayIndex(tomorrow)];
    const tmrPast = [1, 2, 3, 4].map((w) => totals.get(addDays(tomorrow, -7 * w))?.orders).filter((x): x is number => x !== undefined);
    const usual = tmrPast.length ? tmrPast.reduce((t, x) => t + x, 0) / tmrPast.length : null;
    out.push({
      id: "tomorrow", tone: "info",
      title: `${plural(booked, "order")} booked for tomorrow so far`,
      detail: usual !== null ? `A usual ${tmrName} ends with ${usual.toFixed(0)}. Orders until 10am tomorrow still land on ${tmrName}.` : undefined,
      href: `/admin/manage-orders?date=${tomorrow}`,
    });
  }

  // Month pace: month to date vs the same days last month.
  if (!isFuture) {
    const monthStart = `${day.slice(0, 7)}-01`;
    const elapsed = daysBetween(monthStart, day) + 1;
    const [y, m] = day.slice(0, 7).split("-").map(Number);
    const prevStart = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
    const mtd = summarize(snap, { from: monthStart, to: day });
    const lastMtd = summarize(snap, { from: prevStart, to: addDays(prevStart, elapsed - 1) });
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (mtd.revenue > 0 && lastMtd.revenue > 0) {
      const change = pctChange(mtd.revenue, lastMtd.revenue);
      const projected = (mtd.revenue / elapsed) * daysInMonth;
      out.push({
        id: "month-pace",
        tone: change >= MONTH_PACE_SWING_PCT ? "good" : change <= -MONTH_PACE_SWING_PCT ? "watch" : "info",
        title: `Month to date ${rs(mtd.revenue)}, ${signed(change)} vs the same ${elapsed} days last month`,
        detail: `On this pace the month ends near ${rs(projected)}. ${plural(mtd.orders, "order")} so far vs ${lastMtd.orders}.`,
      });
    }
  }

  // Stable order: act, watch, good, info; insertion order within a tone.
  return out.map((x, i) => ({ x, i })).sort((a, b) => TONE_RANK[a.x.tone] - TONE_RANK[b.x.tone] || a.i - b.i).map(({ x }) => x);
}

