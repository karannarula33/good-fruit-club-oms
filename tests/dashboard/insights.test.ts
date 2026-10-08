import { describe, expect, it } from "vitest";
import { dailyInsights } from "@/lib/dashboard/insights";
import { addDays, type MLine, type MOrder, type Snapshot } from "@/lib/dashboard/metrics";

const line = (over: Partial<MLine> = {}): MLine => ({
  productId: "p1", actualQty: 1, price: 1000, cogsPerUnit: 600, packaging: 5, delivery: 50, labour: 2,
  lineStatus: "packed", isSubstitution: false, isGiftBox: false, ...over,
});
let n = 0;
const order = (customerId: string, deliveryDate: string, lines: MLine[] = [line()], status = "packed"): MOrder => ({
  id: `o${++n}`, customerId, deliveryDate, status, lines,
});

const DAY = "2026-10-08"; // Thursday
const snap = (orders: MOrder[]): Snapshot => ({
  orders,
  customers: [
    { id: "c1", name: "Asha", zone: "DLF Phase 2", isInternal: false },
    { id: "c2", name: "Bina", zone: "DLF Phase 1", isInternal: false },
    { id: "c3", name: "Chitra", zone: "DLF Phase 1", isInternal: false },
    { id: "k", name: "Kapoor's", zone: "DLF Phase 2", isInternal: true },
  ],
  products: [{ id: "p1", name: "Papaya", category: "Tropical" }, { id: "p2", name: "Kiwi", category: "Exotics" }],
  overheads: [],
});

// Four earlier Thursdays with `perDay` orders of ₹1,000 each.
const pastThursdays = (perDay: number) =>
  [1, 2, 3, 4].flatMap((w) => Array.from({ length: perDay }, () => order("c3", addDays(DAY, -7 * w))));

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("daily insights", () => {
  it("calls out revenue well above a usual same weekday", () => {
    const today = Array.from({ length: 10 }, () => order("c1", DAY));
    const ins = dailyInsights(snap([...pastThursdays(5), ...today]), DAY, DAY);
    const rev = ins.find((i) => i.id === "revenue-weekday")!;
    expect(rev.tone).toBe("good");
    expect(rev.title).toBe("Revenue +100% vs a usual Thursday");
  });

  it("flags a low day as watch and stays neutral within the band", () => {
    const low = dailyInsights(snap([...pastThursdays(10), ...Array.from({ length: 3 }, () => order("c1", DAY))]), DAY, DAY);
    expect(low.find((i) => i.id === "revenue-weekday")!.tone).toBe("watch");
    expect(ids(low)).toContain("low-day");
    const normal = dailyInsights(snap([...pastThursdays(8), ...Array.from({ length: 8 }, () => order("c1", DAY))]), DAY, DAY);
    expect(normal.find((i) => i.id === "revenue-weekday")!.tone).toBe("info");
    expect(ids(normal)).not.toContain("low-day");
  });

  it("ignores internal accounts and cancelled orders", () => {
    const ins = dailyInsights(snap([...pastThursdays(8), order("k", DAY), order("c1", DAY, [line()], "cancelled")]), DAY, DAY);
    expect(ins.find((i) => i.id === "no-orders")).toBeTruthy();
  });

  it("names new members and quick second orders", () => {
    const ins = dailyInsights(snap([order("c2", addDays(DAY, -5)), order("c2", DAY), order("c1", DAY)]), DAY, DAY);
    expect(ins.find((i) => i.id === "new-members")!.detail).toContain("Asha");
    expect(ins.find((i) => i.id === "second-orders")!.detail).toContain("Bina");
  });

  it("lists unavailable lines, replacements and ₹1 placeholders", () => {
    const ins = dailyInsights(snap([
      order("c1", DAY, [line(), line({ productId: "p2", lineStatus: "unavailable", actualQty: null }), line({ productId: "p2", lineStatus: "unavailable", actualQty: null })]),
      order("c2", DAY, [line(), line({ price: 0, cogsPerUnit: 80 })]),
      order("c3", addDays(DAY, -3), [line({ price: 1 })]),
    ]), DAY, DAY);
    expect(ins.find((i) => i.id === "unavailable")!.detail).toContain("Kiwi ×2");
    const rep = ins.find((i) => i.id === "replacements")!;
    expect(rep.detail).toContain("Papaya for Bina");
    expect(rep.detail).toContain("₹80");
    expect(ins.find((i) => i.id === "placeholder")!.tone).toBe("act");
  });

  it("flags past-day orders that were never packed, not ones left at packed", () => {
    const ins = dailyInsights(snap([
      order("c1", addDays(DAY, -2), [line()], "recorded"),
      order("c2", addDays(DAY, -2), [line()], "packed"),
      order("c3", DAY, [line()], "recorded"),
    ]), DAY, DAY);
    const u = ins.find((i) => i.id === "unpacked")!;
    expect(u.title).toBe("1 order from earlier days never packed");
    expect(u.detail).toContain("Asha");
  });

  it("asks for COGS only once a day is past the grace period", () => {
    const noCogs = (d: string) => order("c1", d, [line({ cogsPerUnit: null })]);
    const fresh = dailyInsights(snap([noCogs(DAY), noCogs(addDays(DAY, -1))]), DAY, DAY);
    expect(ids(fresh)).not.toContain("cogs-missing");
    const old = dailyInsights(snap([noCogs(DAY), noCogs(addDays(DAY, -3))]), DAY, DAY);
    expect(old.find((i) => i.id === "cogs-missing")!.detail).toContain("5 Oct");
  });

  it("shows tomorrow's book only when looking at today, and sorts act before good before info", () => {
    const orders = [order("c1", DAY), order("c2", addDays(DAY, 1), [line({ actualQty: null })], "recorded"), order("c3", addDays(DAY, -3), [line({ price: 1 })])];
    const ins = dailyInsights(snap(orders), DAY, DAY);
    expect(ins.find((i) => i.id === "tomorrow")!.title).toBe("1 order booked for tomorrow so far");
    const rank = { act: 0, watch: 1, good: 2, info: 3 };
    const tones = ins.map((i) => rank[i.tone]);
    expect(tones).toEqual([...tones].sort((a, b) => a - b));
    expect(ids(dailyInsights(snap(orders), addDays(DAY, -1), DAY))).not.toContain("tomorrow");
  });

  it("paces the month against the same days last month", () => {
    const ins = dailyInsights(snap([
      order("c1", "2026-09-02"), order("c1", "2026-10-02"), order("c2", "2026-10-03"),
    ]), DAY, DAY);
    const pace = ins.find((i) => i.id === "month-pace")!;
    expect(pace.tone).toBe("good");
    expect(pace.title).toBe("Month to date ₹2,000, +100% vs the same 8 days last month");
  });
});
