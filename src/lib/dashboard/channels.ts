// Website vs WhatsApp (admin, 2026-10-27). Every order has a channel
// (orders.channel, migration 0038): 'website' when placed on goodfruit.club,
// 'whatsapp' for everything else, WhatsApp groups included.
//
// Two complementary views, both over the same countable orders as the rest of
// the dashboard (no cancelled orders, no internal accounts):
//
//   1. By ORDER channel -- the normal dashboard summary run on only that
//      channel's orders. "Repeat rate (website)" there means members who
//      placed 2+ website orders. Good for "how is each channel doing".
//
//   2. By ACQUISITION channel -- members grouped by the channel of their
//      FIRST order, then everything they did afterwards on any channel.
//      Good for "do customers we win on the website come back, and where".
//
// Lifetime figures are as of the end of the selected range, like the rest of
// the dashboard.

import {
  ACTIVE_DAYS, countableOrders, daysBetween, orderEconomics, summarize,
  type DateRange, type MOrder, type Snapshot, type Summary,
} from "./metrics";

export type Channel = "website" | "whatsapp";
export const CHANNELS: Channel[] = ["website", "whatsapp"];
export const CHANNEL_LABEL: Record<Channel, string> = { website: "Website", whatsapp: "WhatsApp" };

// Days a new member has to place a second order to count as an early repeat.
export const EARLY_REPEAT_DAYS = 30;

export function channelOf(o: MOrder): Channel {
  return o.channel === "website" ? "website" : "whatsapp";
}

export function onlyChannel(snap: Snapshot, channel: Channel): Snapshot {
  return { ...snap, orders: snap.orders.filter((o) => channelOf(o) === channel) };
}

const pct = (n: number, d: number): number | null => (d > 0 ? (n / d) * 100 : null);
const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

// ---------- 1. by order channel ----------

export interface ChannelSummaries {
  all: { cur: Summary; prev: Summary };
  website: { cur: Summary; prev: Summary };
  whatsapp: { cur: Summary; prev: Summary };
}

export function channelSummaries(snap: Snapshot, current: DateRange, previous: DateRange): ChannelSummaries {
  const web = onlyChannel(snap, "website");
  const wa = onlyChannel(snap, "whatsapp");
  return {
    all: { cur: summarize(snap, current), prev: summarize(snap, previous) },
    website: { cur: summarize(web, current), prev: summarize(web, previous) },
    whatsapp: { cur: summarize(wa, current), prev: summarize(wa, previous) },
  };
}

// ---------- 2. by acquisition channel ----------

interface Visit { date: string; channel: Channel; revenue: number }
interface History { customerId: string; visits: Visit[] } // sorted by date

function histories(snap: Snapshot, asOf: string): History[] {
  const map = new Map<string, Visit[]>();
  for (const o of countableOrders(snap)) {
    if (o.deliveryDate > asOf) continue;
    const list = map.get(o.customerId) ?? [];
    list.push({ date: o.deliveryDate, channel: channelOf(o), revenue: orderEconomics(o).revenue });
    map.set(o.customerId, list);
  }
  // Same-day orders: website first, so a member whose first day had both is
  // counted as website-acquired only when that really was their first order
  // (ties are rare; this keeps the result deterministic).
  return [...map.entries()].map(([customerId, visits]) => ({
    customerId,
    visits: visits.sort((a, b) => (a.date === b.date ? (a.channel === b.channel ? 0 : a.channel === "website" ? -1 : 1) : a.date < b.date ? -1 : 1)),
  }));
}

export interface AcquisitionRow {
  channel: Channel;
  members: number; // first order on this channel, up to the range end
  newInRange: number; // of those, first order inside the range
  returnedPct: number | null; // 2+ orders, any channel
  returnedSameChannelPct: number | null; // a later order on the same channel
  usedOtherChannelPct: number | null; // a later order on the other channel
  earlyRepeatPct: number | null; // 2nd order within 30 days, of members with 30+ days to do it
  ordersPerMember: number | null;
  ltv: number | null; // lifetime revenue, all channels
  activePct: number | null; // ordered in the last 14 days
}

export interface ChannelCohortRow {
  month: string; // YYYY-MM of the first order
  channel: Channel;
  members: number;
  returnedPct: number | null;
  earlyRepeatPct: number | null;
  ltv: number | null;
}

export interface ChannelMixRow {
  channel: Channel;
  orders: number;
  orderShare: number | null;
  revenue: number;
  revenueShare: number | null;
  members: number; // distinct members ordering on this channel in range
}

export interface ChannelReport {
  acquisition: AcquisitionRow[];
  cohorts: ChannelCohortRow[];
  mix: ChannelMixRow[];
  bothChannelsInRange: number; // members who used both channels in the range
  bothChannelsLifetime: number; // members who have ever used both
}

function earlyRepeat(h: History, asOf: string): boolean | null {
  const first = h.visits[0].date;
  if (daysBetween(first, asOf) < EARLY_REPEAT_DAYS) return null; // not enough time yet
  // A second order on the same day as the first doesn't count as coming back.
  const second = h.visits.find((v) => v.date > first);
  return !!second && daysBetween(first, second.date) <= EARLY_REPEAT_DAYS;
}

function acquisitionRow(channel: Channel, hs: History[], range: DateRange): AcquisitionRow {
  const n = hs.length;
  const eligible = hs.map((h) => earlyRepeat(h, range.to)).filter((x): x is boolean => x !== null);
  const orders = hs.reduce((s, h) => s + h.visits.length, 0);
  const revenue = hs.reduce((s, h) => s + h.visits.reduce((t, v) => t + v.revenue, 0), 0);
  return {
    channel,
    members: n,
    newInRange: hs.filter((h) => h.visits[0].date >= range.from && h.visits[0].date <= range.to).length,
    returnedPct: pct(hs.filter((h) => h.visits.length >= 2).length, n),
    returnedSameChannelPct: pct(hs.filter((h) => h.visits.slice(1).some((v) => v.channel === channel)).length, n),
    usedOtherChannelPct: pct(hs.filter((h) => h.visits.slice(1).some((v) => v.channel !== channel)).length, n),
    earlyRepeatPct: pct(eligible.filter(Boolean).length, eligible.length),
    ordersPerMember: ratio(orders, n),
    ltv: ratio(revenue, n),
    activePct: pct(hs.filter((h) => daysBetween(h.visits[h.visits.length - 1].date, range.to) < ACTIVE_DAYS).length, n),
  };
}

export function channelReport(snap: Snapshot, range: DateRange): ChannelReport {
  const hs = histories(snap, range.to);
  const byFirst = (c: Channel) => hs.filter((h) => h.visits[0].channel === c);

  const acquisition = CHANNELS.map((c) => acquisitionRow(c, byFirst(c), range));

  const cohortAcc = new Map<string, History[]>();
  for (const h of hs) {
    const key = `${h.visits[0].date.slice(0, 7)}|${h.visits[0].channel}`;
    cohortAcc.set(key, [...(cohortAcc.get(key) ?? []), h]);
  }
  const cohorts: ChannelCohortRow[] = [...cohortAcc.entries()]
    .map(([key, group]) => {
      const [month, channel] = key.split("|") as [string, Channel];
      const eligible = group.map((h) => earlyRepeat(h, range.to)).filter((x): x is boolean => x !== null);
      return {
        month,
        channel,
        members: group.length,
        returnedPct: pct(group.filter((h) => h.visits.length >= 2).length, group.length),
        earlyRepeatPct: pct(eligible.filter(Boolean).length, eligible.length),
        ltv: ratio(group.reduce((s, h) => s + h.visits.reduce((t, v) => t + v.revenue, 0), 0), group.length),
      };
    })
    .sort((a, b) => (a.month === b.month ? CHANNELS.indexOf(a.channel) - CHANNELS.indexOf(b.channel) : a.month < b.month ? -1 : 1));

  const inRange = countableOrders(snap).filter((o) => o.deliveryDate >= range.from && o.deliveryDate <= range.to);
  const totalRevenue = inRange.reduce((s, o) => s + orderEconomics(o).revenue, 0);
  const mix: ChannelMixRow[] = CHANNELS.map((c) => {
    const os = inRange.filter((o) => channelOf(o) === c);
    const revenue = os.reduce((s, o) => s + orderEconomics(o).revenue, 0);
    return {
      channel: c,
      orders: os.length,
      orderShare: pct(os.length, inRange.length),
      revenue,
      revenueShare: pct(revenue, totalRevenue),
      members: new Set(os.map((o) => o.customerId)).size,
    };
  });

  const channelsInRange = new Map<string, Set<Channel>>();
  for (const o of inRange) channelsInRange.set(o.customerId, (channelsInRange.get(o.customerId) ?? new Set()).add(channelOf(o)));

  return {
    acquisition,
    cohorts,
    mix,
    bothChannelsInRange: [...channelsInRange.values()].filter((s) => s.size === 2).length,
    bothChannelsLifetime: hs.filter((h) => new Set(h.visits.map((v) => v.channel)).size === 2).length,
  };
}
