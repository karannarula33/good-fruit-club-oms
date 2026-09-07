import { describe, expect, it } from "vitest";
import { computeDeliveryCost, type DeliveryCostInput } from "@/lib/delivery/delivery-cost";

const BASE: DeliveryCostInput = {
  hubDailyFee: 600,
  ordersOnDeliveryDate: 15,
  distanceKm: 3,
  baseFee: 50,
  baseKm: 3,
  perKmRate: 9,
  billTotal: 1000,
  isCashPaid: false,
  codFeePct: 0.007,
  orderWeightKg: 1,
  weightThresholdKg: 2,
  perKgRate: 10,
};

describe("computeDeliveryCost", () => {
  it("splits the daily hub fee evenly across that day's orders", () => {
    const cost = computeDeliveryCost(BASE);
    // hub share 40 + base fee 50 (within 3km, no COD, under weight threshold)
    expect(cost).toBe(90);
  });

  it("charges only the base fee within the base km radius", () => {
    const cost = computeDeliveryCost({ ...BASE, hubDailyFee: 0, distanceKm: 2 });
    expect(cost).toBe(50);
  });

  it("charges per-km beyond the base radius", () => {
    const cost = computeDeliveryCost({ ...BASE, hubDailyFee: 0, distanceKm: 10 });
    // 50 base + (10 - 3) * 9 = 50 + 63
    expect(cost).toBe(113);
  });

  it("adds the COD fee only when paid cash", () => {
    const unpaidCash = computeDeliveryCost({ ...BASE, hubDailyFee: 0, isCashPaid: false });
    const paidCash = computeDeliveryCost({ ...BASE, hubDailyFee: 0, isCashPaid: true });
    expect(unpaidCash).toBe(50);
    expect(paidCash).toBe(50 + 1000 * 0.007);
  });

  it("charges only for weight above the threshold", () => {
    const underThreshold = computeDeliveryCost({ ...BASE, hubDailyFee: 0, orderWeightKg: 2 });
    const overThreshold = computeDeliveryCost({ ...BASE, hubDailyFee: 0, orderWeightKg: 5 });
    expect(underThreshold).toBe(50);
    expect(overThreshold).toBe(50 + (5 - 2) * 10);
  });

  it("is zero when there are no orders that day (no divide-by-zero)", () => {
    const cost = computeDeliveryCost({ ...BASE, ordersOnDeliveryDate: 0, hubDailyFee: 600 });
    expect(cost).toBe(50);
  });
});
