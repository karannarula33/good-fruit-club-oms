import { describe, expect, it } from "vitest";
import { channelOf, channelReport, channelSummaries, onlyChannel } from "@/lib/dashboard/channels";
import type { MLine, MOrder, Snapshot } from "@/lib/dashboard/metrics";

const line = (price = 100): MLine => ({
  productId: "p1", actualQty: 1, price, cogsPerUnit: 60, packaging: 5, delivery: 10, labour: 2,
  lineStatus: "packed", isSubstitution: false, isGiftBox: false,
});
const o = (id: string, c: string, date: string, channel?: "website" | "whatsapp", price = 100, status = "delivered"): MOrder =>
  ({ id, customerId: c, deliveryDate: date, status, lines: [line(price)], channel });

const snap = (orders: MOrder[]): Snapshot => ({
  orders,
  customers: ["w1", "w2", "w3", "a1", "a2", "k"].map((id) => ({ id, name: id, zone: null, isInternal: id === "k" })),
  products: [{ id: "p1", name: "Papaya", category: null }],
  overheads: [],
});

// w1: website first, back on WhatsApp after 10 days, then website again
// w2: website once
// w3: website first, second website order 40 days later
// a1: WhatsApp first, then website the same week
// a2: WhatsApp, back on WhatsApp after 5 days; a cancelled website order
// k : internal account, ignored everywhere
const data = snap([
  o("1", "w1", "2026-09-01", "website", 500),
  o("2", "w1", "2026-09-11", "whatsapp", 300),
  o("3", "w1", "2026-10-05", "website", 200),
  o("4", "w2", "2026-09-20", "website", 400),
  o("5", "w3", "2026-08-10", "website", 100),
  o("6", "w3", "2026-09-19", "website", 100),
  o("7", "a1", "2026-09-02", "whatsapp", 250),
  o("8", "a1", "2026-09-06", "website", 250),
  o("9", "a2", "2026-09-03", undefined, 150), // no channel = WhatsApp
  o("10", "a2", "2026-09-08", "whatsapp", 150),
  o("11", "a2", "2026-09-09", "website", 999, "cancelled"),
  o("12", "k", "2026-09-05", "website", 5000),
]);
const sept = { from: "2026-09-01", to: "2026-09-30" };
const aug = { from: "2026-08-01", to: "2026-08-31" };

describe("channel of an order", () => {
  it("treats anything but website as WhatsApp", () => {
    expect(channelOf(o("x", "c", "2026-09-01"))).toBe("whatsapp");
    expect(channelOf(o("x", "c", "2026-09-01", "website"))).toBe("website");
    expect(onlyChannel(data, "website").orders.every((x) => x.channel === "website")).toBe(true);
  });
});

describe("summaries by order channel", () => {
  it("splits orders and revenue, and the two add up to the total", () => {
    const s = channelSummaries(data, sept, aug);
    // Sept, countable: website 1(500) 4(400) 6(100) 8(250); WhatsApp 2(300) 7(250) 9(150) 10(150)
    expect(s.website.cur.orders).toBe(4);
    expect(s.website.cur.revenue).toBe(1250);
    expect(s.whatsapp.cur.orders).toBe(4);
    expect(s.whatsapp.cur.revenue).toBe(850);
    expect(s.all.cur.orders).toBe(s.website.cur.orders + s.whatsapp.cur.orders);
    expect(s.all.cur.revenue).toBe(2100);
  });
  it("counts repeat within the channel only", () => {
    const s = channelSummaries(data, sept, aug);
    // Website members by end of Sept: w1(1 site order by 30 Sep), w2(1), w3(2), a1(1) -> 1 of 4 repeat
    expect(s.website.cur.repeatRate).toBe(25);
    // WhatsApp members: w1(1), a1(1), a2(2) -> 1 of 3
    expect(s.whatsapp.cur.repeatRate).toBeCloseTo(33.33, 1);
  });
});

describe("report by acquisition channel", () => {
  const r = channelReport(data, { from: "2026-09-01", to: "2026-10-31" });
  const web = r.acquisition.find((a) => a.channel === "website")!;
  const wa = r.acquisition.find((a) => a.channel === "whatsapp")!;

  it("groups members by the channel of their first order", () => {
    expect(web.members).toBe(3); // w1, w2, w3
    expect(wa.members).toBe(2); // a1, a2
    expect(web.newInRange).toBe(2); // w1, w2 (w3 started in Aug)
  });
  it("follows them across channels", () => {
    expect(web.returnedPct).toBeCloseTo(66.67, 1); // w1, w3
    expect(web.returnedSameChannelPct).toBeCloseTo(66.67, 1); // w1 (5 Oct), w3
    expect(web.usedOtherChannelPct).toBeCloseTo(33.33, 1); // w1 on WhatsApp
    expect(wa.returnedPct).toBe(100);
    expect(wa.usedOtherChannelPct).toBe(50); // a1 moved to the website
    expect(wa.returnedSameChannelPct).toBe(50); // a2
  });
  it("measures a second order within 30 days for members who've had 30 days", () => {
    // all 5 started 30+ days before 31 Oct: w1 yes(10d), w2 no, w3 no(40d), a1 yes, a2 yes
    expect(web.earlyRepeatPct).toBeCloseTo(33.33, 1);
    expect(wa.earlyRepeatPct).toBe(100);
  });
  it("lifetime value includes orders on either channel", () => {
    expect(web.ltv).toBeCloseTo((1000 + 400 + 200) / 3, 5);
    expect(wa.ltv).toBe((500 + 300) / 2);
    expect(web.ordersPerMember).toBeCloseTo(6 / 3, 5);
  });
  it("shows the order mix in range and members who use both", () => {
    const m = Object.fromEntries(r.mix.map((x) => [x.channel, x]));
    expect(m.website.orders).toBe(5); // 1,3,4,6,8
    expect(m.whatsapp.orders).toBe(4);
    expect(m.website.revenueShare! + m.whatsapp.revenueShare!).toBeCloseTo(100, 5);
    expect(r.bothChannelsInRange).toBe(2); // w1, a1
    expect(r.bothChannelsLifetime).toBe(2);
  });
  it("builds monthly cohorts per acquisition channel", () => {
    expect(r.cohorts.map((c) => `${c.month} ${c.channel} ${c.members}`)).toEqual([
      "2026-08 website 1", "2026-09 website 2", "2026-09 whatsapp 2",
    ]);
  });
  it("only counts what had happened by the end of the range", () => {
    const early = channelReport(data, { from: "2026-09-01", to: "2026-09-10" });
    const w = early.acquisition.find((a) => a.channel === "website")!;
    expect(w.members).toBe(2); // w1, w3 (w2 starts 20 Sept)
    expect(w.earlyRepeatPct).toBe(0); // only w3 has had 30 days, and didn't return within them
  });
});
