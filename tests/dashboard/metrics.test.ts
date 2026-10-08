import { describe, expect, it } from "vitest";
import {
  addDays, breakdowns, clampToToday, daysBetween, orderEconomics, resolveRanges, summarize, weekNumber,
  type MLine, type MOrder, type Snapshot,
} from "@/lib/dashboard/metrics";

const line = (over: Partial<MLine> = {}): MLine => ({
  productId: "p1", actualQty: 1, price: 100, cogsPerUnit: 60, packaging: 5, delivery: 10, labour: 2,
  lineStatus: "packed", isSubstitution: false, isGiftBox: false, ...over,
});
const order = (id: string, customerId: string, deliveryDate: string, lines: MLine[], status = "packed"): MOrder => ({ id, customerId, deliveryDate, status, lines });

const base = (orders: MOrder[]): Snapshot => ({
  orders,
  customers: [
    { id: "c1", name: "Asha", zone: "DLF Phase 2", isInternal: false },
    { id: "c2", name: "Bina", zone: null, isInternal: false },
    { id: "c3", name: "Kapoor's", zone: "DLF Phase 2", isInternal: true },
  ],
  products: [{ id: "p1", name: "Papaya", category: "Tropical" }, { id: "p2", name: "Kiwi", category: "Exotics" }],
  overheads: [],
});

describe("dates", () => {
  it("counts weeks from 2 June", () => {
    expect(weekNumber("2026-06-02")).toBe(1);
    expect(weekNumber("2026-06-08")).toBe(1);
    expect(weekNumber("2026-06-09")).toBe(2);
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(daysBetween("2026-09-28", "2026-10-02")).toBe(4);
  });
  it("resolves day, week, month and custom ranges with their comparison", () => {
    expect(resolveRanges("day", "2026-10-08")).toEqual({ current: { from: "2026-10-08", to: "2026-10-08" }, previous: { from: "2026-10-07", to: "2026-10-07" } });
    // 8 Oct 2026 is a Thursday -> Monday 5 Oct
    expect(resolveRanges("week", "2026-10-08")).toEqual({ current: { from: "2026-10-05", to: "2026-10-11" }, previous: { from: "2026-09-28", to: "2026-10-04" } });
    expect(resolveRanges("month", "2026-03-15")).toEqual({ current: { from: "2026-03-01", to: "2026-03-31" }, previous: { from: "2026-02-01", to: "2026-02-28" } });
    expect(resolveRanges("month", "2026-01-10").previous).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(resolveRanges("custom", "x", "2026-09-10", "2026-09-19")).toEqual({ current: { from: "2026-09-10", to: "2026-09-19" }, previous: { from: "2026-08-31", to: "2026-09-09" } });
  });
  it("compares a month in progress with the same days of the previous month", () => {
    const r = clampToToday(resolveRanges("month", "2026-10-08"), "2026-10-08");
    expect(r).toEqual({ current: { from: "2026-10-01", to: "2026-10-08" }, previous: { from: "2026-09-01", to: "2026-09-08" }, partial: true });
  });
});

describe("order economics", () => {
  it("bills sold lines only, rounds each line, and keeps every line's packing/delivery/labour", () => {
    const e = orderEconomics(order("o", "c1", "2026-09-01", [
      line({ actualQty: 1.234, price: 100 }), // 123.4 -> 123
      line({ lineStatus: "unavailable", actualQty: 1 }),
      line({ actualQty: 0 }),
    ]));
    expect(e.revenue).toBe(123);
    expect(e.cogs).toBe(74.04);
    expect(e.soldLines).toBe(1);
    expect(e.packaging).toBe(15);
    expect(e.delivery).toBe(30);
    expect(e.labour).toBe(6);
  });
});

describe("summary", () => {
  const snap = base([
    order("o1", "c1", "2026-09-01", [line(), line({ productId: "p2", price: 400, cogsPerUnit: 380 })]),
    order("o2", "c2", "2026-09-02", [line({ price: 200, cogsPerUnit: 100 })]),
    order("o3", "c1", "2026-09-20", [line({ price: 3000, cogsPerUnit: 2000 })]),
    order("o4", "c2", "2026-09-02", [line()], "cancelled"),
    order("o5", "c3", "2026-09-02", [line()]), // internal
  ]);
  const s = summarize(snap, { from: "2026-09-01", to: "2026-09-30" });
  it("excludes cancelled and internal orders", () => expect(s.orders).toBe(3));
  it("computes revenue, AOV and margins", () => {
    expect(s.revenue).toBe(3700);
    expect(s.aov).toBeCloseTo(3700 / 3);
    expect(s.cogs).toBe(2540);
    expect(s.grossMarginPct).toBeCloseTo((1160 / 3700) * 100);
    expect(s.packaging).toBe(20);
    expect(s.delivery).toBe(40);
    expect(s.labour).toBe(8);
    expect(s.contribution).toBe(3700 - 2540 - 20 - 40 - 8);
    expect(s.deliveryPerOrder).toBeCloseTo(40 / 3);
    expect(s.breakEvenOrderValue).toBeCloseTo((68 / 3) / (1160 / 3700));
  });
  it("computes order shape metrics", () => {
    expect(s.itemsPerOrder).toBeCloseTo(4 / 3);
    expect(s.singleItemShare).toBeCloseTo(200 / 3);
    expect(s.under500Count).toBe(1); // o2 = 200
    expect(s.giftBulkCount).toBe(1); // o3 = 3000
    expect(s.operatingDays).toBe(3);
    expect(s.lowOrderDays).toBe(3);
  });
  it("computes member metrics as of the range end", () => {
    expect(s.newMembers).toBe(2);
    expect(s.repeatRate).toBe(50); // c1 has 2 orders, c2 has 1
    expect(s.activeMembers).toBe(1); // only c1 ordered in the last 14 days of Sep
    expect(s.ltvMedian).toBe((500 + 3200) / 2);
    expect(s.thirdOrderRate).toBe(0);
  });
  it("nets out overheads", () => {
    const withOh = summarize({ ...snap, overheads: [{ date: "2026-09-05", category: "ads", amount: 1000 }, { date: "2026-09-06", category: "day_level", amount: 100 }, { date: "2026-10-01", category: "ads", amount: 999 }] }, { from: "2026-09-01", to: "2026-09-30" });
    expect(withOh.adSpend).toBe(1000);
    expect(withOh.dayLevelCosts).toBe(100);
    expect(withOh.netAfterOverheads).toBe(withOh.contribution - 1100);
  });
  it("flags reactivated members and second orders within 14 days", () => {
    const s2 = summarize(base([
      order("a", "c1", "2026-08-01", [line()]),
      order("b", "c1", "2026-09-10", [line()]), // 40 days later -> reactivated
      order("c", "c2", "2026-09-01", [line()]),
      order("d", "c2", "2026-09-08", [line()]), // 2nd within 14 days
    ]), { from: "2026-09-01", to: "2026-09-30" });
    expect(s2.reactivatedMembers).toBe(1);
    expect(s2.secondOrderRate14).toBe(100);
  });
});

describe("breakdowns", () => {
  const snap = base([
    order("o1", "c1", "2026-09-01", [line(), line({ productId: "p2", price: 400, cogsPerUnit: 380 })]),
    order("o2", "c1", "2026-09-05", [line({ productId: "p2", price: 300, cogsPerUnit: 300 }), line({ lineStatus: "unavailable" })]),
    order("o3", "c2", "2026-09-28", [line({ cogsPerUnit: 70 }), line({ productId: "p2", price: 400, cogsPerUnit: 380 })]),
  ]);
  const b = breakdowns(snap, { from: "2026-09-01", to: "2026-09-30" });
  it("ranks products and flags low margins and price exceptions", () => {
    expect(b.products[0].name).toBe("Kiwi");
    expect(b.lowMarginProducts.map((p) => p.name)).toEqual(["Kiwi"]);
    expect(b.priceExceptions.map((p) => p.date)).toEqual(["2026-09-05"]);
    expect(b.unavailableByProduct).toEqual([{ name: "Papaya", count: 1 }]);
    expect(b.pairings[0]).toEqual({ a: "Papaya", b: "Kiwi", orders: 2 });
  });
  it("tracks COGS moves week on week", () => {
    const move = b.cogsMoves.find((m) => m.name === "Papaya");
    expect(move).toBeUndefined(); // no papaya sold 15-21 Sep
  });
  it("groups zones with Unassigned for blank zones", () => {
    expect(b.unassignedOrders).toBe(1);
    expect(b.zones.map((z) => z.zone).sort()).toEqual(["DLF Phase 2", "Unassigned"]);
  });
  it("lists members quiet past twice their usual gap", () => {
    // c1: gap of 4 days, last order 5 Sep -> 25 days quiet on 30 Sep
    expect(b.quietMembers.map((q) => q.name)).toEqual(["Asha"]);
    expect(b.quietMembers[0].usualGap).toBe(4);
  });
  it("builds cohorts and status mix", () => {
    expect(b.cohorts).toHaveLength(1);
    expect(b.cohorts[0].members).toBe(2);
    expect(b.memberStatus.find((m) => m.status === "Active")!.members).toBe(1);
    expect(b.memberStatus.find((m) => m.status === "Cooling")!.members).toBe(1);
  });
});
