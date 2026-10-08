// Dashboard metrics engine. Pure functions over a plain snapshot of the
// business (orders + lines, customers, products, overheads) so every number
// on /admin/dashboard is computed in one tested place.
//
// Conventions (admin decisions, 2026-10-08):
//   * An order counts on its DELIVERY date (the day its COGS, packing and
//     delivery costs are booked), not when it was placed.
//   * Cancelled orders and internal customers (e.g. "Kapoor's") are excluded
//     from every metric -- no revenue, no cost.
//   * Revenue = sum over SOLD lines of round(actual qty x locked price), the
//     same per-line rounding the WhatsApp bill uses (roundLineAmount). A sold
//     line has actual_qty > 0 and is not marked unavailable.
//   * Costs: COGS = actual qty x locked COGS per unit (sold lines); packaging,
//     delivery and labour are the per-line amounts the cost scripts write.
//   * "Members" = customers. Lifetime figures (LTV, repeat rate, status) are
//     as of the END of the selected range, so looking at an old range shows
//     the picture as it was then.

import { roundLineAmount, roundToCents } from "@/lib/billing/compute";

// ---------- input shapes ----------

export interface MLine {
  productId: string | null;
  actualQty: number | null;
  price: number | null;
  cogsPerUnit: number | null;
  packaging: number | null;
  delivery: number | null;
  labour: number | null;
  lineStatus: string;
  isSubstitution: boolean;
  isGiftBox: boolean;
}

export interface MOrder {
  id: string;
  customerId: string;
  deliveryDate: string; // YYYY-MM-DD
  status: string;
  lines: MLine[];
}

export interface MCustomer {
  id: string;
  name: string;
  zone: string | null;
  isInternal: boolean;
}

export interface MProduct {
  id: string;
  name: string;
  category: string | null;
}

export interface MOverhead {
  date: string; // YYYY-MM-DD
  category: string; // "ads" | "day_level" | "other"
  amount: number;
}

export interface Snapshot {
  orders: MOrder[];
  customers: MCustomer[];
  products: MProduct[];
  overheads: MOverhead[];
}

export interface DateRange {
  from: string; // inclusive YYYY-MM-DD
  to: string; // inclusive YYYY-MM-DD
}

// ---------- date helpers (calendar days, no time zone involved) ----------

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function rangeLength(r: DateRange): number {
  return daysBetween(r.from, r.to) + 1;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function weekdayIndex(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

// Week 1 starts on 2 June 2026 (the first trading day); weeks are 7-day
// blocks from there.
export const WEEK_ONE_START = "2026-06-02";
export function weekNumber(date: string): number {
  return Math.floor(daysBetween(WEEK_ONE_START, date) / 7) + 1;
}
export function weekStart(week: number): string {
  return addDays(WEEK_ONE_START, (week - 1) * 7);
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);
const pct = (num: number, den: number): number | null => (den > 0 ? (num / den) * 100 : null);

// ---------- per-order economics ----------

export function isSold(l: MLine): boolean {
  return (l.actualQty ?? 0) > 0 && l.lineStatus !== "unavailable";
}

// A sold line charged ₹1 or less was given free. Admin, 2026-10-08: these are
// mostly replacements for a poor-quality item (the original usually isn't
// collected back, so both items' cost is real). Atta samples and festive
// gift cards/diyas are free extras, counted separately.
export const FREE_PRICE_MAX = 1;
const FREEBIE_NAMES = /atta|gift card|gift diya/i;
export type FreeKind = "replacement" | "freebie";
export function freeKind(l: MLine, productName: string): FreeKind | null {
  if (!isSold(l) || l.price === null || l.price > FREE_PRICE_MAX) return null;
  return FREEBIE_NAMES.test(productName) ? "freebie" : "replacement";
}

export interface OrderEconomics {
  revenue: number;
  cogs: number;
  packaging: number;
  delivery: number;
  labour: number;
  soldLines: number;
  allLines: number;
  hasGiftLine: boolean;
}

export function orderEconomics(o: MOrder): OrderEconomics {
  let revenue = 0, cogs = 0, packaging = 0, delivery = 0, labour = 0, soldLines = 0;
  let hasGiftLine = false;
  for (const l of o.lines) {
    packaging += l.packaging ?? 0;
    delivery += l.delivery ?? 0;
    labour += l.labour ?? 0;
    if (!isSold(l)) continue;
    soldLines++;
    if (l.isGiftBox) hasGiftLine = true;
    if (l.price !== null) revenue += roundLineAmount(l.actualQty!, l.price);
    if (l.cogsPerUnit !== null) cogs += (l.actualQty ?? 0) * l.cogsPerUnit;
  }
  return {
    revenue,
    cogs: roundToCents(cogs),
    packaging: roundToCents(packaging),
    delivery: roundToCents(delivery),
    labour: roundToCents(labour),
    soldLines,
    allLines: o.lines.length,
    hasGiftLine,
  };
}

// Orders that count anywhere on the dashboard.
export function countableOrders(snap: Snapshot): MOrder[] {
  const internal = new Set(snap.customers.filter((c) => c.isInternal).map((c) => c.id));
  return snap.orders.filter((o) => o.status !== "cancelled" && !internal.has(o.customerId));
}

// ---------- the range summary (everything with a previous-period delta) ----------

export interface Summary {
  revenue: number;
  orders: number;
  aov: number | null;
  cogs: number;
  packaging: number;
  delivery: number;
  labour: number;
  grossMarginPct: number | null;
  contribution: number;
  contributionPct: number | null;
  deliveryPctOfRevenue: number | null;
  deliveryPerOrder: number | null;
  packagingPerOrder: number | null;
  labourPerOrder: number | null;
  contributionPerOrder: number | null;
  breakEvenOrderValue: number | null;
  overheads: number;
  adSpend: number;
  dayLevelCosts: number;
  netAfterOverheads: number;
  operatingDays: number;
  revenuePerOperatingDay: number | null;
  itemsPerOrder: number | null;
  singleItemShare: number | null;
  under500Count: number;
  under500Share: number | null;
  giftBulkCount: number;
  giftBulkShare: number | null;
  lowOrderDays: number;
  unavailableRate: number | null;
  substitutionRate: number | null;
  replacementCount: number;
  replacementOrders: number;
  replacementCost: number;
  replacementOrderShare: number | null;
  replacementCostPct: number | null;
  freebieCount: number;
  freebieCost: number;
  activeMembers: number;
  newMembers: number;
  reactivatedMembers: number;
  repeatRate: number | null;
  ltvAverage: number | null;
  ltvMedian: number | null;
  top10Share: number | null;
  retention: number | null;
  secondOrderRate14: number | null;
  thirdOrderRate: number | null;
  coverage: { cogs: number | null; packaging: number | null; delivery: number | null; labour: number | null };
}

export const LOW_ORDER_DAY_THRESHOLD = 7;
export const ACTIVE_DAYS = 14;
export const COOLING_MAX_DAYS = 30;
export const SMALL_ORDER_LIMIT = 500;
export const BULK_ORDER_LIMIT = 3000;

interface MemberHistory {
  customerId: string;
  dates: string[]; // sorted delivery dates of every countable order up to `asOf`
  revenue: number; // lifetime revenue up to `asOf`
}

function memberHistories(orders: MOrder[], asOf: string): Map<string, MemberHistory> {
  const map = new Map<string, MemberHistory>();
  for (const o of orders) {
    if (o.deliveryDate > asOf) continue;
    const h = map.get(o.customerId) ?? { customerId: o.customerId, dates: [], revenue: 0 };
    h.dates.push(o.deliveryDate);
    h.revenue += orderEconomics(o).revenue;
    map.set(o.customerId, h);
  }
  for (const h of map.values()) h.dates.sort();
  return map;
}

export function summarize(snap: Snapshot, range: DateRange): Summary {
  const all = countableOrders(snap);
  const inRange = all.filter((o) => o.deliveryDate >= range.from && o.deliveryDate <= range.to);
  const econ = inRange.map(orderEconomics);

  let revenue = 0, cogs = 0, packaging = 0, delivery = 0, labour = 0, soldLines = 0, allLines = 0;
  let single = 0, under500 = 0, giftBulk = 0;
  let unavailable = 0, substitutions = 0;
  let replacementCount = 0, replacementCost = 0, freebieCount = 0, freebieCost = 0;
  const replacementOrderIds = new Set<string>();
  const nameOf = new Map(snap.products.map((p) => [p.id, p.name]));
  let soldCount = 0, cogsCosted = 0, packCosted = 0, delCosted = 0, labCosted = 0;
  const ordersPerDay = new Map<string, number>();
  const revenueByMember = new Map<string, number>();

  inRange.forEach((o, i) => {
    const e = econ[i];
    revenue += e.revenue; cogs += e.cogs; packaging += e.packaging; delivery += e.delivery; labour += e.labour;
    soldLines += e.soldLines; allLines += e.allLines;
    if (e.soldLines === 1) single++;
    if (e.revenue < SMALL_ORDER_LIMIT) under500++;
    if (e.hasGiftLine || e.revenue >= BULK_ORDER_LIMIT) giftBulk++;
    ordersPerDay.set(o.deliveryDate, (ordersPerDay.get(o.deliveryDate) ?? 0) + 1);
    revenueByMember.set(o.customerId, (revenueByMember.get(o.customerId) ?? 0) + e.revenue);
    for (const l of o.lines) {
      if (l.lineStatus === "unavailable") unavailable++;
      if (l.isSubstitution) substitutions++;
      const free = freeKind(l, (l.productId && nameOf.get(l.productId)) || "");
      const freeCost = (l.actualQty ?? 0) * (l.cogsPerUnit ?? 0);
      if (free === "replacement") { replacementCount++; replacementCost += freeCost; replacementOrderIds.add(o.id); }
      if (free === "freebie") { freebieCount++; freebieCost += freeCost; }
      if (!isSold(l)) continue;
      soldCount++;
      if (l.cogsPerUnit !== null) cogsCosted++;
      if (l.packaging !== null) packCosted++;
      if (l.delivery !== null) delCosted++;
      if (l.labour !== null) labCosted++;
    }
  });

  const orders = inRange.length;
  const contribution = revenue - cogs - packaging - delivery - labour;
  const grossRatio = ratio(revenue - cogs, revenue);
  const perOrderVariable = orders > 0 ? (packaging + delivery + labour) / orders : null;

  const overheadsInRange = snap.overheads.filter((x) => x.date >= range.from && x.date <= range.to);
  const adSpend = overheadsInRange.filter((x) => x.category === "ads").reduce((s, x) => s + x.amount, 0);
  const dayLevelCosts = overheadsInRange.filter((x) => x.category !== "ads").reduce((s, x) => s + x.amount, 0);
  const overheads = adSpend + dayLevelCosts;

  // Members, as of the end of the range.
  const histories = memberHistories(all, range.to);
  const lifetimes = [...histories.values()];
  const activeMembers = lifetimes.filter((h) => daysBetween(h.dates[h.dates.length - 1], range.to) < ACTIVE_DAYS).length;
  const newMembers = lifetimes.filter((h) => h.dates[0] >= range.from && h.dates[0] <= range.to).length;

  // Reactivated: an order in range whose previous order (any time before) was 30+ days earlier.
  let reactivated = 0;
  for (const h of lifetimes) {
    const hit = h.dates.some((d, i) => d >= range.from && d <= range.to && i > 0 && daysBetween(h.dates[i - 1], d) >= 30);
    if (hit) reactivated++;
  }

  const ltvs = lifetimes.map((h) => h.revenue);
  const sortedRange = [...revenueByMember.values()].sort((a, b) => b - a);
  const top10 = sortedRange.slice(0, 10).reduce((s, x) => s + x, 0);

  // Retention: of the members who ordered in the previous same-length period,
  // the share who ordered again in this one.
  const len = rangeLength(range);
  const prevFrom = addDays(range.from, -len);
  const prevTo = addDays(range.from, -1);
  const prevMembers = new Set(all.filter((o) => o.deliveryDate >= prevFrom && o.deliveryDate <= prevTo).map((o) => o.customerId));
  const thisMembers = new Set(inRange.map((o) => o.customerId));
  const retained = [...prevMembers].filter((m) => thisMembers.has(m)).length;

  // Second order within 14 days: members whose FIRST order falls in the range
  // and is at least 14 days before the range end (so they've had the chance).
  const eligible = lifetimes.filter((h) => h.dates[0] >= range.from && h.dates[0] <= range.to && daysBetween(h.dates[0], range.to) >= 14);
  const secondIn14 = eligible.filter((h) => h.dates.length > 1 && daysBetween(h.dates[0], h.dates[1]) <= 14).length;
  const twoPlus = lifetimes.filter((h) => h.dates.length >= 2).length;
  const threePlus = lifetimes.filter((h) => h.dates.length >= 3).length;

  return {
    revenue,
    orders,
    aov: ratio(revenue, orders),
    cogs: roundToCents(cogs),
    packaging: roundToCents(packaging),
    delivery: roundToCents(delivery),
    labour: roundToCents(labour),
    grossMarginPct: grossRatio === null ? null : grossRatio * 100,
    contribution: roundToCents(contribution),
    contributionPct: pct(contribution, revenue),
    deliveryPctOfRevenue: pct(delivery, revenue),
    deliveryPerOrder: ratio(delivery, orders),
    packagingPerOrder: ratio(packaging, orders),
    labourPerOrder: ratio(labour, orders),
    contributionPerOrder: ratio(contribution, orders),
    // The order value at which an average order's gross margin just covers its
    // packing, delivery and labour: those costs per order / gross margin ratio.
    breakEvenOrderValue: perOrderVariable !== null && grossRatio !== null && grossRatio > 0 ? perOrderVariable / grossRatio : null,
    overheads: roundToCents(overheads),
    adSpend: roundToCents(adSpend),
    dayLevelCosts: roundToCents(dayLevelCosts),
    netAfterOverheads: roundToCents(contribution - overheads),
    operatingDays: ordersPerDay.size,
    revenuePerOperatingDay: ratio(revenue, ordersPerDay.size),
    itemsPerOrder: ratio(soldLines, orders),
    singleItemShare: pct(single, orders),
    under500Count: under500,
    under500Share: pct(under500, orders),
    giftBulkCount: giftBulk,
    giftBulkShare: pct(giftBulk, orders),
    lowOrderDays: [...ordersPerDay.values()].filter((n) => n < LOW_ORDER_DAY_THRESHOLD).length,
    unavailableRate: pct(unavailable, allLines),
    substitutionRate: pct(substitutions, allLines),
    replacementCount,
    replacementOrders: replacementOrderIds.size,
    replacementCost: roundToCents(replacementCost),
    replacementOrderShare: pct(replacementOrderIds.size, orders),
    replacementCostPct: pct(replacementCost, revenue),
    freebieCount,
    freebieCost: roundToCents(freebieCost),
    activeMembers,
    newMembers,
    reactivatedMembers: reactivated,
    repeatRate: pct(twoPlus, lifetimes.length),
    ltvAverage: ratio(ltvs.reduce((s, x) => s + x, 0), ltvs.length),
    ltvMedian: median(ltvs),
    top10Share: pct(top10, revenue),
    retention: pct(retained, prevMembers.size),
    secondOrderRate14: pct(secondIn14, eligible.length),
    thirdOrderRate: pct(threePlus, twoPlus),
    coverage: {
      cogs: pct(cogsCosted, soldCount),
      packaging: pct(packCosted, soldCount),
      delivery: pct(delCosted, soldCount),
      labour: pct(labCosted, soldCount),
    },
  };
}

// ---------- breakdown tables (shown for the selected range) ----------

export interface DayRow { date: string; orders: number; revenue: number; grossMargin: number }
export interface WeekRow { week: number; start: string; orders: number; revenue: number; aov: number | null }
export interface WeekdayRow { day: string; orders: number; revenue: number; orderShare: number | null; revenueShare: number | null }
export interface ProductRow {
  id: string; name: string; category: string; revenue: number; cogs: number; grossMarginPct: number | null;
  customers: number; soldLines: number; unavailableLines: number; costedShare: number | null;
}
export interface CategoryRow { category: string; revenue: number; share: number | null; grossMarginPct: number | null }
export interface CogsMove { id: string; name: string; lastWeek: number; thisWeek: number; changePct: number }
export interface PriceException { date: string; product: string; customer: string; price: number; cogs: number }
export interface FreeItem { date: string; product: string; customer: string; qty: number; cost: number; kind: FreeKind }
export interface Pairing { a: string; b: string; orders: number }
export interface StatusRow { status: string; orders: number }
export interface ZoneRow {
  zone: string; members: number; orders: number; revenue: number; aov: number | null;
  deliveryPerOrder: number | null; deliveryPct: number | null; contributionPct: number | null;
  ordersPerMember: number | null; newMembers: number;
}
export interface QuietMember { id: string; name: string; zone: string; lastOrder: string; daysSince: number; usualGap: number; orders: number; lifetimeRevenue: number }
export interface CohortRow { month: string; members: number; returnedPct: number | null; threePlusPct: number | null; ltv: number | null; activePct: number | null }
export interface StatusMixRow { status: "Active" | "Cooling" | "Lapsed"; members: number; lifetimeRevenue: number }

export interface Breakdowns {
  daily: DayRow[];
  weekly: WeekRow[];
  weekdays: WeekdayRow[];
  products: ProductRow[];
  categories: CategoryRow[];
  lowMarginProducts: ProductRow[];
  cogsMoves: CogsMove[];
  priceExceptions: PriceException[];
  freeItems: FreeItem[];
  pairings: Pairing[];
  unavailableByProduct: { name: string; count: number }[];
  statusMix: StatusRow[];
  lowOrderDays: { date: string; orders: number }[];
  zones: ZoneRow[];
  unassignedOrders: number;
  quietMembers: QuietMember[];
  cohorts: CohortRow[];
  memberStatus: StatusMixRow[];
}

export const LOW_MARGIN_PCT = 25;
export const LOW_MARGIN_MIN_REVENUE = 200;
export const COGS_MOVE_PCT = 10;

export function breakdowns(snap: Snapshot, range: DateRange): Breakdowns {
  const all = countableOrders(snap);
  const inRange = all.filter((o) => o.deliveryDate >= range.from && o.deliveryDate <= range.to);
  const productById = new Map(snap.products.map((p) => [p.id, p]));
  const customerById = new Map(snap.customers.map((c) => [c.id, c]));
  const pname = (id: string | null) => (id && productById.get(id)?.name) || "Unknown product";
  const zoneOf = (customerId: string) => customerById.get(customerId)?.zone || "Unassigned";

  // Daily + weekday
  const daily = new Map<string, DayRow>();
  const weekdays = DAY_NAMES.map((day) => ({ day, orders: 0, revenue: 0 }));
  let totalRevenue = 0;
  for (const o of inRange) {
    const e = orderEconomics(o);
    totalRevenue += e.revenue;
    const d = daily.get(o.deliveryDate) ?? { date: o.deliveryDate, orders: 0, revenue: 0, grossMargin: 0 };
    d.orders++; d.revenue += e.revenue; d.grossMargin += e.revenue - e.cogs;
    daily.set(o.deliveryDate, d);
    const w = weekdays[weekdayIndex(o.deliveryDate)];
    w.orders++; w.revenue += e.revenue;
  }
  // Monday-first order reads better for a working week.
  const weekdayRows = [...weekdays.slice(1), weekdays[0]].map((w) => ({
    ...w, orderShare: pct(w.orders, inRange.length), revenueShare: pct(w.revenue, totalRevenue),
  }));

  // Weekly (every week from Week 1 up to the range end, for the trend).
  const weekly = new Map<number, WeekRow>();
  for (const o of all) {
    if (o.deliveryDate > range.to || o.deliveryDate < WEEK_ONE_START) continue;
    const wk = weekNumber(o.deliveryDate);
    const row = weekly.get(wk) ?? { week: wk, start: weekStart(wk), orders: 0, revenue: 0, aov: null };
    row.orders++; row.revenue += orderEconomics(o).revenue;
    weekly.set(wk, row);
  }
  const weeklyRows = [...weekly.values()].sort((a, b) => a.week - b.week).map((w) => ({ ...w, aov: ratio(w.revenue, w.orders) }));

  // Products
  const prod = new Map<string, ProductRow & { customerSet: Set<string>; costedSold: number }>();
  const pairCounts = new Map<string, number>();
  const unavailable = new Map<string, number>();
  const priceExceptions: PriceException[] = [];
  const freeItems: FreeItem[] = [];
  for (const o of inRange) {
    const soldIds = new Set<string>();
    for (const l of o.lines) {
      const id = l.productId ?? "unknown";
      const p = productById.get(id);
      const row = prod.get(id) ?? {
        id, name: pname(l.productId), category: p?.category || "Uncategorised", revenue: 0, cogs: 0, grossMarginPct: null,
        customers: 0, soldLines: 0, unavailableLines: 0, costedShare: null, customerSet: new Set<string>(), costedSold: 0,
      };
      if (l.lineStatus === "unavailable") {
        row.unavailableLines++;
        unavailable.set(row.name, (unavailable.get(row.name) ?? 0) + 1);
      }
      if (isSold(l)) {
        row.soldLines++;
        row.customerSet.add(o.customerId);
        if (l.price !== null) row.revenue += roundLineAmount(l.actualQty!, l.price);
        if (l.cogsPerUnit !== null) { row.cogs += (l.actualQty ?? 0) * l.cogsPerUnit; row.costedSold++; }
        soldIds.add(id);
        const free = freeKind(l, row.name);
        if (free) {
          freeItems.push({ date: o.deliveryDate, product: row.name, customer: customerById.get(o.customerId)?.name ?? "Unknown", qty: l.actualQty ?? 0, cost: roundToCents((l.actualQty ?? 0) * (l.cogsPerUnit ?? 0)), kind: free });
        } else if (l.price !== null && l.cogsPerUnit !== null && l.price <= l.cogsPerUnit && !l.isGiftBox) {
          priceExceptions.push({ date: o.deliveryDate, product: row.name, customer: customerById.get(o.customerId)?.name ?? "Unknown", price: l.price, cogs: l.cogsPerUnit });
        }
      }
      prod.set(id, row);
    }
    const ids = [...soldIds].sort();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const k = `${ids[i]}|${ids[j]}`;
      pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1);
    }
  }
  const products: ProductRow[] = [...prod.values()]
    .map(({ customerSet, costedSold, ...r }) => ({
      ...r,
      cogs: roundToCents(r.cogs),
      customers: customerSet.size,
      grossMarginPct: costedSold > 0 ? pct(r.revenue - r.cogs, r.revenue) : null,
      costedShare: pct(costedSold, r.soldLines),
    }))
    .filter((r) => r.soldLines > 0 || r.unavailableLines > 0)
    .sort((a, b) => b.revenue - a.revenue);

  const cat = new Map<string, { revenue: number; cogs: number }>();
  for (const p of products) {
    const c = cat.get(p.category) ?? { revenue: 0, cogs: 0 };
    c.revenue += p.revenue; c.cogs += p.cogs; cat.set(p.category, c);
  }
  const categories = [...cat.entries()]
    .map(([category, c]) => ({ category, revenue: c.revenue, share: pct(c.revenue, totalRevenue), grossMarginPct: pct(c.revenue - c.cogs, c.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);

  // Ignore products with almost no revenue (free samples, ₹0.01 gift-box
  // components) so the flag list shows real pricing problems.
  const lowMarginProducts = products.filter((p) => p.grossMarginPct !== null && p.grossMarginPct < LOW_MARGIN_PCT && p.revenue >= LOW_MARGIN_MIN_REVENUE);

  // COGS per unit: the last 7 days of the range vs the 7 days before.
  const thisWeekFrom = addDays(range.to, -6);
  const lastWeekFrom = addDays(range.to, -13);
  const avgCost = (from: string, to: string) => {
    const acc = new Map<string, { qty: number; cost: number }>();
    for (const o of all) {
      if (o.deliveryDate < from || o.deliveryDate > to) continue;
      for (const l of o.lines) {
        if (!isSold(l) || l.cogsPerUnit === null || !l.productId) continue;
        const a = acc.get(l.productId) ?? { qty: 0, cost: 0 };
        a.qty += l.actualQty!; a.cost += l.actualQty! * l.cogsPerUnit;
        acc.set(l.productId, a);
      }
    }
    return new Map([...acc].map(([k, v]) => [k, v.qty > 0 ? v.cost / v.qty : 0]));
  };
  const nowCost = avgCost(thisWeekFrom, range.to);
  const prevCost = avgCost(lastWeekFrom, addDays(thisWeekFrom, -1));
  const cogsMoves: CogsMove[] = [];
  for (const [id, now] of nowCost) {
    const before = prevCost.get(id);
    if (!before) continue;
    const changePct = ((now - before) / before) * 100;
    cogsMoves.push({ id, name: pname(id), lastWeek: roundToCents(before), thisWeek: roundToCents(now), changePct });
  }
  cogsMoves.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

  const pairings = [...pairCounts.entries()]
    .map(([k, n]) => { const [a, b] = k.split("|"); return { a: pname(a), b: pname(b), orders: n }; })
    .sort((x, y) => y.orders - x.orders)
    .slice(0, 10);

  const statusCounts = new Map<string, number>();
  for (const o of inRange) statusCounts.set(o.status, (statusCounts.get(o.status) ?? 0) + 1);
  const STATUS_ORDER = ["recorded", "packed", "dispatched", "out_for_delivery", "delivered", "undelivered"];
  const statusMix = STATUS_ORDER.filter((s) => statusCounts.has(s)).map((s) => ({ status: s, orders: statusCounts.get(s)! }));

  const lowOrderDays = [...daily.values()]
    .filter((d) => d.orders < LOW_ORDER_DAY_THRESHOLD)
    .map((d) => ({ date: d.date, orders: d.orders }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Zones
  const histories = memberHistories(all, range.to);
  const zoneAcc = new Map<string, { members: Set<string>; orders: number; revenue: number; delivery: number; contribution: number; newMembers: number }>();
  for (const o of inRange) {
    const z = zoneOf(o.customerId);
    const e = orderEconomics(o);
    const acc = zoneAcc.get(z) ?? { members: new Set<string>(), orders: 0, revenue: 0, delivery: 0, contribution: 0, newMembers: 0 };
    acc.members.add(o.customerId); acc.orders++; acc.revenue += e.revenue; acc.delivery += e.delivery;
    acc.contribution += e.revenue - e.cogs - e.packaging - e.delivery - e.labour;
    zoneAcc.set(z, acc);
  }
  for (const h of histories.values()) {
    if (h.dates[0] < range.from || h.dates[0] > range.to) continue;
    const acc = zoneAcc.get(zoneOf(h.customerId));
    if (acc) acc.newMembers++;
  }
  const zones = [...zoneAcc.entries()]
    .map(([zone, a]) => ({
      zone, members: a.members.size, orders: a.orders, revenue: a.revenue, aov: ratio(a.revenue, a.orders),
      deliveryPerOrder: ratio(a.delivery, a.orders), deliveryPct: pct(a.delivery, a.revenue),
      contributionPct: pct(a.contribution, a.revenue), ordersPerMember: ratio(a.orders, a.members.size), newMembers: a.newMembers,
    }))
    .sort((a, b) => b.revenue - a.revenue);
  const unassignedOrders = zoneAcc.get("Unassigned")?.orders ?? 0;

  // Members quiet past their normal gap (as of the range end): needs 2+ orders,
  // usual gap = median days between consecutive orders, quiet when the days
  // since the last order exceed twice that.
  const quietMembers: QuietMember[] = [];
  for (const h of histories.values()) {
    if (h.dates.length < 2) continue;
    const gaps = h.dates.slice(1).map((d, i) => daysBetween(h.dates[i], d)).filter((g) => g > 0);
    const usual = median(gaps);
    if (!usual) continue;
    const last = h.dates[h.dates.length - 1];
    const since = daysBetween(last, range.to);
    if (since > 2 * usual) {
      const c = customerById.get(h.customerId);
      quietMembers.push({ id: h.customerId, name: c?.name ?? "Unknown", zone: c?.zone || "Unassigned", lastOrder: last, daysSince: since, usualGap: usual, orders: h.dates.length, lifetimeRevenue: h.revenue });
    }
  }
  // Most valuable first: these are the win-back calls worth making today.
  quietMembers.sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue);

  // Cohorts by first-order month.
  const cohortAcc = new Map<string, MemberHistory[]>();
  for (const h of histories.values()) {
    const m = h.dates[0].slice(0, 7);
    cohortAcc.set(m, [...(cohortAcc.get(m) ?? []), h]);
  }
  const cohorts = [...cohortAcc.entries()].sort().map(([month, hs]) => ({
    month,
    members: hs.length,
    returnedPct: pct(hs.filter((h) => h.dates.length >= 2).length, hs.length),
    threePlusPct: pct(hs.filter((h) => h.dates.length >= 3).length, hs.length),
    ltv: ratio(hs.reduce((s, h) => s + h.revenue, 0), hs.length),
    activePct: pct(hs.filter((h) => daysBetween(h.dates[h.dates.length - 1], range.to) < ACTIVE_DAYS).length, hs.length),
  }));

  const memberStatus: StatusMixRow[] = (["Active", "Cooling", "Lapsed"] as const).map((status) => ({ status, members: 0, lifetimeRevenue: 0 }));
  for (const h of histories.values()) {
    const since = daysBetween(h.dates[h.dates.length - 1], range.to);
    const row = since < ACTIVE_DAYS ? memberStatus[0] : since <= COOLING_MAX_DAYS ? memberStatus[1] : memberStatus[2];
    row.members++; row.lifetimeRevenue += h.revenue;
  }

  return {
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    weekly: weeklyRows,
    weekdays: weekdayRows,
    products,
    categories,
    lowMarginProducts,
    cogsMoves,
    priceExceptions: priceExceptions.sort((a, b) => b.date.localeCompare(a.date)),
    freeItems: freeItems.sort((a, b) => b.date.localeCompare(a.date)),
    pairings,
    unavailableByProduct: [...unavailable.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    statusMix,
    lowOrderDays,
    zones,
    unassignedOrders,
    quietMembers,
    cohorts,
    memberStatus,
  };
}

// ---------- ranges ----------

export type RangeView = "day" | "week" | "month" | "custom";

// Resolves the selected range and the one it is compared against: the
// previous day, the previous Monday-Sunday week, the previous calendar month,
// or for a custom range the same number of days immediately before it.
export function resolveRanges(view: RangeView, anchor: string, from?: string, to?: string): { current: DateRange; previous: DateRange } {
  if (view === "day") {
    return { current: { from: anchor, to: anchor }, previous: { from: addDays(anchor, -1), to: addDays(anchor, -1) } };
  }
  if (view === "week") {
    const offset = (weekdayIndex(anchor) + 6) % 7; // days since Monday
    const monday = addDays(anchor, -offset);
    return {
      current: { from: monday, to: addDays(monday, 6) },
      previous: { from: addDays(monday, -7), to: addDays(monday, -1) },
    };
  }
  if (view === "month") {
    const [y, m] = anchor.slice(0, 7).split("-").map(Number);
    const first = `${anchor.slice(0, 7)}-01`;
    const nextFirst = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const prevFirst = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
    return { current: { from: first, to: addDays(nextFirst, -1) }, previous: { from: prevFirst, to: addDays(first, -1) } };
  }
  const f = from && to && from <= to ? from : anchor;
  const t = from && to && from <= to ? to : anchor;
  const len = daysBetween(f, t) + 1;
  return { current: { from: f, to: t }, previous: { from: addDays(f, -len), to: addDays(f, -1) } };
}

// A range that runs past today is cut at today, and the comparison period is
// cut to the same number of days, so a month in progress (1-8 Oct) is compared
// with the same days of the previous month (1-8 Sep), not the whole of it.
export function clampToToday(ranges: { current: DateRange; previous: DateRange }, today: string): { current: DateRange; previous: DateRange; partial: boolean } {
  if (ranges.current.to <= today || ranges.current.from > today) return { ...ranges, partial: false };
  const current = { from: ranges.current.from, to: today };
  const len = rangeLength(current);
  const prevTo = addDays(ranges.previous.from, len - 1);
  return { current, previous: { from: ranges.previous.from, to: prevTo < ranges.previous.to ? prevTo : ranges.previous.to }, partial: true };
}
