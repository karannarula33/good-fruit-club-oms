import { describe, expect, it } from "vitest";
import { buildRationale } from "@/lib/engagement/rationale";

describe("buildRationale", () => {
  it("describes a vip_checkin regardless of state", () => {
    expect(
      buildRationale({
        state: "habituated",
        vipCheckin: true,
        orderCount: 10,
        daysSinceLast: 12,
        expectedGapDays: 5,
        severityRatio: 1.0,
      }),
    ).toBe("VIP, on rhythm, silent 12d.");
  });

  it("gives prospects a fixed no-orders sentence", () => {
    expect(
      buildRationale({ state: "prospect", vipCheckin: false, orderCount: 0, daysSinceLast: null, expectedGapDays: null, severityRatio: null }),
    ).toBe("No orders yet.");
  });

  it("gives first_timers a grace-period sentence", () => {
    expect(
      buildRationale({ state: "first_timer", vipCheckin: false, orderCount: 1, daysSinceLast: 5, expectedGapDays: 14, severityRatio: 0.36 }),
    ).toBe("1 order, 5d ago -- still within grace.");
  });

  it("formats sub-10-day gaps to one decimal place", () => {
    const text = buildRationale({
      state: "breaking",
      vipCheckin: false,
      orderCount: 5,
      daysSinceLast: 14,
      expectedGapDays: 3.5,
      severityRatio: 4.0,
    });
    expect(text).toBe("Orders every ~3.5d, silent 14d (4.0x).");
  });

  it("rounds gaps of 10 days or more to a whole number", () => {
    const text = buildRationale({
      state: "third_order_risk",
      vipCheckin: false,
      orderCount: 2,
      daysSinceLast: 20,
      expectedGapDays: 14,
      severityRatio: 1.43,
    });
    expect(text).toBe("Orders every ~14d, silent 20d (1.4x).");
  });

  it("falls back to an order-count sentence when severity data is missing", () => {
    const text = buildRationale({
      state: "breaking",
      vipCheckin: false,
      orderCount: 3,
      daysSinceLast: null,
      expectedGapDays: null,
      severityRatio: null,
    });
    expect(text).toBe("3 orders, silent so far.");
  });
});
