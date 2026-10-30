// Area-wise breakdown (admin 2026-10-28): city -> area -> society, from the
// customer's location read off their address (customers.city / area /
// locality, migration 0039). Replaces the dashboard's old route-zone table,
// where half the members sat in "Unassigned".
//
// Same countable orders as the rest of the dashboard (no cancelled, no
// internal). In-range figures use orders delivered in the range; "members"
// and repeat rate are lifetime as of the range end.

import { channelOf } from "./channels";
import { countableOrders, orderEconomics, type DateRange, type MCustomer, type Snapshot } from "./metrics";

export const UNKNOWN_AREA = "Area not known";
export const UNKNOWN_CITY = "City not known";

export interface AreaRow {
  city: string;
  area: string; // the city name itself on city rows
  orders: number;
  revenue: number;
  revenueShare: number | null;
  aov: number | null;
  activeMembers: number; // ordered in the range
  newMembers: number; // first order in the range
  lifetimeMembers: number; // ever ordered, up to range end
  repeatRate: number | null; // lifetime members with 2+ orders
  ordersPerMember: number | null; // in range
  deliveryPerOrder: number | null;
  contributionPct: number | null;
  websiteShare: number | null; // share of the range's orders placed on the website
}

export interface SocietyRow { locality: string; area: string; city: string; members: number; orders: number; revenue: number }

export interface AreaReport {
  cities: AreaRow[];
  areas: AreaRow[];
  societies: SocietyRow[];
  unknownAreaOrders: number;
}

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
const ratio = (n: number, d: number) => (d > 0 ? n / d : null);

interface Acc {
  city: string; area: string;
  orders: number; revenue: number; delivery: number; contribution: number; website: number;
  active: Set<string>; newMembers: number; lifetime: Map<string, number>;
}

function newAcc(city: string, area: string): Acc {
  return { city, area, orders: 0, revenue: 0, delivery: 0, contribution: 0, website: 0, active: new Set(), newMembers: 0, lifetime: new Map() };
}

function toRow(a: Acc, totalRevenue: number): AreaRow {
  const lifetime = [...a.lifetime.values()];
  return {
    city: a.city,
    area: a.area,
    orders: a.orders,
    revenue: a.revenue,
    revenueShare: pct(a.revenue, totalRevenue),
    aov: ratio(a.revenue, a.orders),
    activeMembers: a.active.size,
    newMembers: a.newMembers,
    lifetimeMembers: lifetime.length,
    repeatRate: pct(lifetime.filter((n) => n >= 2).length, lifetime.length),
    ordersPerMember: ratio(a.orders, a.active.size),
    deliveryPerOrder: ratio(a.delivery, a.orders),
    contributionPct: pct(a.contribution, a.revenue),
    websiteShare: pct(a.website, a.orders),
  };
}

export function areaReport(snap: Snapshot, range: DateRange): AreaReport {
  const byId = new Map<string, MCustomer>(snap.customers.map((c) => [c.id, c]));
  const cityOf = (id: string) => byId.get(id)?.city || UNKNOWN_CITY;
  const areaOf = (id: string) => byId.get(id)?.area || UNKNOWN_AREA;

  const all = countableOrders(snap).filter((o) => o.deliveryDate <= range.to);
  const inRange = all.filter((o) => o.deliveryDate >= range.from);
  const totalRevenue = inRange.reduce((s, o) => s + orderEconomics(o).revenue, 0);

  const cities = new Map<string, Acc>();
  const areas = new Map<string, Acc>();
  const accFor = (id: string) => {
    const city = cityOf(id), area = areaOf(id);
    if (!cities.has(city)) cities.set(city, newAcc(city, city));
    const key = `${city}|${area}`;
    if (!areas.has(key)) areas.set(key, newAcc(city, area));
    return [cities.get(city)!, areas.get(key)!];
  };

  // Lifetime order counts and first order dates, per member.
  const firstOrder = new Map<string, string>();
  for (const o of all) {
    for (const a of accFor(o.customerId)) a.lifetime.set(o.customerId, (a.lifetime.get(o.customerId) ?? 0) + 1);
    const f = firstOrder.get(o.customerId);
    if (!f || o.deliveryDate < f) firstOrder.set(o.customerId, o.deliveryDate);
  }
  for (const o of inRange) {
    const e = orderEconomics(o);
    for (const a of accFor(o.customerId)) {
      a.orders++;
      a.revenue += e.revenue;
      a.delivery += e.delivery;
      a.contribution += e.revenue - e.cogs - e.packaging - e.delivery - e.labour;
      if (channelOf(o) === "website") a.website++;
      a.active.add(o.customerId);
    }
  }
  for (const [id, first] of firstOrder) {
    if (first < range.from) continue;
    for (const a of accFor(id)) a.newMembers++;
  }

  const byRevenue = (x: AreaRow, y: AreaRow) => y.revenue - x.revenue || y.lifetimeMembers - x.lifetimeMembers;

  // Societies: members and in-range business, for named societies only.
  const soc = new Map<string, SocietyRow & { ids: Set<string> }>();
  for (const o of inRange) {
    const c = byId.get(o.customerId);
    if (!c?.locality) continue;
    const key = `${c.city}|${c.area}|${c.locality}`;
    const row = soc.get(key) ?? { locality: c.locality, area: c.area || UNKNOWN_AREA, city: c.city || UNKNOWN_CITY, members: 0, orders: 0, revenue: 0, ids: new Set<string>() };
    row.orders++;
    row.revenue += orderEconomics(o).revenue;
    row.ids.add(o.customerId);
    row.members = row.ids.size;
    soc.set(key, row);
  }

  return {
    cities: [...cities.values()].map((a) => toRow(a, totalRevenue)).filter((r) => r.lifetimeMembers > 0).sort(byRevenue),
    areas: [...areas.values()].map((a) => toRow(a, totalRevenue)).filter((r) => r.lifetimeMembers > 0).sort(byRevenue),
    societies: [...soc.values()]
      .map(({ ids, ...r }) => { void ids; return r; })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 25),
    unknownAreaOrders: inRange.filter((o) => !byId.get(o.customerId)?.area).length,
  };
}
