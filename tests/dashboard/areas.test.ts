import { describe, expect, it } from "vitest";
import { UNKNOWN_AREA, areaReport } from "@/lib/dashboard/areas";
import type { MLine, MOrder, Snapshot } from "@/lib/dashboard/metrics";

const line = (price: number, delivery = 10): MLine => ({
  productId: "p1", actualQty: 1, price, cogsPerUnit: price * 0.6, packaging: 5, delivery, labour: 2,
  lineStatus: "packed", isSubstitution: false, isGiftBox: false,
});
const o = (id: string, c: string, date: string, price: number, channel: "website" | "whatsapp" = "whatsapp", status = "delivered"): MOrder =>
  ({ id, customerId: c, deliveryDate: date, status, lines: [line(price)], channel });

const snap = (orders: MOrder[]): Snapshot => ({
  orders,
  customers: [
    { id: "a", name: "A", zone: "DLF Phase 2", isInternal: false, city: "Gurgaon", area: "DLF Phase 2", locality: "Heritage City" },
    { id: "b", name: "B", zone: "DLF Phase 2", isInternal: false, city: "Gurgaon", area: "DLF Phase 2", locality: null },
    { id: "c", name: "C", zone: "Unassigned", isInternal: false, city: "Delhi", area: "Paschim Vihar", locality: null },
    { id: "d", name: "D", zone: "Unassigned", isInternal: false, city: null, area: null, locality: null },
    { id: "k", name: "Kapoor's", zone: "DLF Phase 2", isInternal: true, city: "Gurgaon", area: "DLF Phase 2", locality: null },
  ],
  products: [{ id: "p1", name: "Papaya", category: null }],
  overheads: [],
});

const data = snap([
  o("1", "a", "2026-09-20", 1000),
  o("2", "a", "2026-10-05", 600, "website"),
  o("3", "b", "2026-10-06", 400),
  o("4", "c", "2026-10-07", 1000, "website"),
  o("5", "c", "2026-10-09", 500),
  o("6", "d", "2026-10-10", 500),
  o("7", "b", "2026-10-11", 900, "whatsapp", "cancelled"),
  o("8", "k", "2026-10-12", 9999),
]);
const oct = { from: "2026-10-01", to: "2026-10-31" };

describe("area report", () => {
  const r = areaReport(data, oct);
  const area = (name: string) => r.areas.find((a) => a.area === name)!;
  const city = (name: string) => r.cities.find((a) => a.city === name)!;

  it("splits the range's orders and revenue by area, ignoring cancelled and internal orders", () => {
    expect(area("DLF Phase 2")).toMatchObject({ city: "Gurgaon", orders: 2, revenue: 1000, activeMembers: 2 });
    expect(area("Paschim Vihar")).toMatchObject({ city: "Delhi", orders: 2, revenue: 1500, activeMembers: 1 });
    expect(area(UNKNOWN_AREA)).toMatchObject({ orders: 1, revenue: 500 });
    expect(r.unknownAreaOrders).toBe(1);
    expect(r.areas.reduce((s, a) => s + a.revenue, 0)).toBe(3000);
    expect(r.areas[0].area).toBe("Paschim Vihar"); // highest revenue first
  });

  it("rolls areas up to cities", () => {
    expect(city("Gurgaon").revenue).toBe(1000);
    expect(city("Delhi").revenueShare).toBe(50);
  });

  it("counts new members, lifetime repeat and website share per area", () => {
    const dlf = area("DLF Phase 2");
    expect(dlf.newMembers).toBe(1); // b; a started in September
    expect(dlf.lifetimeMembers).toBe(2);
    expect(dlf.repeatRate).toBe(50); // a has 2 orders, b has 1 (its 2nd was cancelled)
    expect(dlf.websiteShare).toBe(50);
    expect(area("Paschim Vihar").ordersPerMember).toBe(2);
    expect(area("Paschim Vihar").aov).toBe(750);
  });

  it("lists named societies", () => {
    expect(r.societies).toEqual([{ locality: "Heritage City", area: "DLF Phase 2", city: "Gurgaon", members: 1, orders: 1, revenue: 600 }]);
  });

  it("keeps areas with lifetime members even when quiet in the range", () => {
    const sept = areaReport(data, { from: "2026-10-20", to: "2026-10-31" });
    expect(sept.areas.find((a) => a.area === "DLF Phase 2")).toMatchObject({ orders: 0, lifetimeMembers: 2 });
  });
});
