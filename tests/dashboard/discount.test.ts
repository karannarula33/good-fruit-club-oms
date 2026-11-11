import { describe, expect, it } from "vitest";
import { orderEconomics, type MOrder } from "@/lib/dashboard/metrics";

const order = (discount?: number): MOrder => ({
  id: "o", customerId: "c", deliveryDate: "2026-11-11", status: "delivered", discount,
  lines: [{ productId: "p", actualQty: 2, billedQty: null, price: 300, cogsPerUnit: 200, packaging: null, delivery: null, labour: null, lineStatus: "packed", isSubstitution: false, isGiftBox: false }],
});

describe("order discount in dashboard revenue", () => {
  it("comes off revenue, not COGS", () => {
    expect(orderEconomics(order(100))).toMatchObject({ revenue: 500, cogs: 400 });
    expect(orderEconomics(order()).revenue).toBe(600);
  });
  it("never takes revenue below zero", () => expect(orderEconomics(order(900)).revenue).toBe(0));
});
