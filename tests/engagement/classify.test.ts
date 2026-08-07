import { describe, expect, it } from "vitest";
import {
  classifyState,
  computeCustomerState,
  computeExpectedGapDays,
  lineValue,
  type EngagementOrderInput,
} from "@/lib/engagement/classify";
import { buildEngagementConfig, type EngagementConfig } from "@/lib/engagement/config";

const config: EngagementConfig = buildEngagementConfig([
  { key: "VIP_PERCENTILE", value: 0.9 },
  { key: "COHORT_DEFAULT_GAP_DAYS", value: 14 },
  { key: "SECOND_ORDER_GRACE_DAYS", value: 9 },
  { key: "THIRD_ORDER_GRACE_DAYS", value: 9 },
  { key: "DRIFT_SEVERITY_LOW", value: 1.5 },
  { key: "DRIFT_SEVERITY_MID", value: 2.0 },
  { key: "DRIFT_SEVERITY_HIGH", value: 3.5 },
  { key: "LAPSED_ABSOLUTE_DAYS", value: 30 },
  { key: "VIP_CHECKIN_INTERVAL_DAYS", value: 10 },
  { key: "FREQUENCY_CAP_DAYS", value: 10 },
  { key: "UNANSWERED_COOLDOWN_COUNT", value: 2 },
  { key: "UNANSWERED_COOLDOWN_DAYS", value: 30 },
  { key: "CALL_ESCALATION_ENABLED", value: 1 },
]);

describe("buildEngagementConfig", () => {
  it("throws when a required key is missing (fail loud, never silently default a threshold)", () => {
    expect(() => buildEngagementConfig([{ key: "VIP_PERCENTILE", value: 0.9 }])).toThrow(
      /COHORT_DEFAULT_GAP_DAYS/,
    );
  });
});

describe("lineValue", () => {
  it("uses actual_qty when present", () => {
    expect(lineValue(2, 3, 100)).toBe(200);
  });

  it("falls back to ordered_qty when actual_qty is null (unpacked order)", () => {
    expect(lineValue(null, 3, 100)).toBe(300);
  });

  it("contributes 0 when locked_price_per_unit is null (unpriced line), never silently prices it", () => {
    expect(lineValue(2, 3, null)).toBe(0);
  });

  it("is 0 when both quantities are null", () => {
    expect(lineValue(null, null, 100)).toBe(0);
  });
});

describe("computeExpectedGapDays", () => {
  it("returns the cohort default for a single order", () => {
    expect(computeExpectedGapDays([new Date("2026-08-01")], config)).toBe(14);
  });

  it("returns the cohort default with zero orders", () => {
    expect(computeExpectedGapDays([], config)).toBe(14);
  });

  it("computes the median gap for an even number of gaps (averages the middle two)", () => {
    const dates = ["2026-08-01", "2026-08-04", "2026-08-10"].map((d) => new Date(d));
    // gaps: 3, 6 -> median of [3, 6] (even count) = 4.5
    expect(computeExpectedGapDays(dates, config)).toBe(4.5);
  });

  it("computes the median gap for an odd number of gaps (takes the middle value)", () => {
    const dates = ["2026-08-01", "2026-08-04", "2026-08-08", "2026-08-11"].map((d) => new Date(d));
    // gaps: 3, 4, 3 -> median = 3
    expect(computeExpectedGapDays(dates, config)).toBe(3);
  });

  it("floors at 0.1 days so a same-day repeat order can't collapse the gap to ~0", () => {
    const dates = [new Date("2026-08-01T09:00:00Z"), new Date("2026-08-01T09:05:00Z")];
    expect(computeExpectedGapDays(dates, config)).toBe(0.1);
  });
});

describe("classifyState", () => {
  it("classifies a customer with zero orders as prospect", () => {
    expect(classifyState({ orderCount: 0, daysSinceLast: null, severityRatio: null }, config)).toBe("prospect");
  });

  it("classifies a fresh single order as first_timer, within grace", () => {
    expect(classifyState({ orderCount: 1, daysSinceLast: 8, severityRatio: 0.57 }, config)).toBe("first_timer");
  });

  it("classifies a single order silent past grace as second_order_risk", () => {
    expect(classifyState({ orderCount: 1, daysSinceLast: 9, severityRatio: 0.64 }, config)).toBe(
      "second_order_risk",
    );
  });

  it("classifies two orders silent past grace, below lapsed/high-severity, as third_order_risk", () => {
    expect(classifyState({ orderCount: 2, daysSinceLast: 10, severityRatio: 2.0 }, config)).toBe("third_order_risk");
  });

  it("does not classify two orders as third_order_risk before their own grace period", () => {
    // days_since_last < THIRD_ORDER_GRACE_DAYS -- falls through to the
    // severity bands instead, same as a 3+ order customer would.
    expect(classifyState({ orderCount: 2, daysSinceLast: 5, severityRatio: 1.0 }, config)).toBe("habituated");
  });

  it("escalates a two-order customer straight to lapsed when severity is very high, skipping third_order_risk", () => {
    expect(classifyState({ orderCount: 2, daysSinceLast: 20, severityRatio: 4.0 }, config)).toBe("lapsed");
  });

  it("classifies an absolute 30+ day silence as lapsed regardless of the customer's own cadence", () => {
    expect(classifyState({ orderCount: 5, daysSinceLast: 30, severityRatio: 1.2 }, config)).toBe("lapsed");
  });

  it("classifies >=3.5x a customer's own gap as lapsed even under the 30-day absolute mark", () => {
    expect(classifyState({ orderCount: 5, daysSinceLast: 25, severityRatio: 3.5 }, config)).toBe("lapsed");
  });

  it("classifies 2.0-3.5x own gap as breaking", () => {
    expect(classifyState({ orderCount: 5, daysSinceLast: 14, severityRatio: 2.0 }, config)).toBe("breaking");
  });

  it("classifies 1.5-2.0x own gap as drifting", () => {
    expect(classifyState({ orderCount: 5, daysSinceLast: 10, severityRatio: 1.5 }, config)).toBe("drifting");
  });

  it("classifies on-rhythm customers as habituated", () => {
    expect(classifyState({ orderCount: 5, daysSinceLast: 3, severityRatio: 0.4 }, config)).toBe("habituated");
  });
});

function order(placedAt: string, lines: EngagementOrderInput["lines"]): EngagementOrderInput {
  return { placedAt: new Date(placedAt), lines };
}

describe("computeCustomerState", () => {
  const now = new Date("2026-08-15T00:00:00Z");

  it("returns a prospect row with zero everything for no orders", () => {
    const result = computeCustomerState([], config, now);
    expect(result.state).toBe("prospect");
    expect(result.orderCount).toBe(0);
    expect(result.revenue).toBe(0);
    expect(result.favouriteProducts).toEqual([]);
    expect(result.daysSinceLast).toBeNull();
  });

  it("sums revenue across orders and lines (caller has already excluded cancelled orders)", () => {
    const orders = [
      order("2026-08-01T00:00:00Z", [{ productName: "Alphonso Mango", value: 500 }]),
      order("2026-08-05T00:00:00Z", [
        { productName: "Alphonso Mango", value: 300 },
        { productName: "Banana", value: 100 },
      ]),
    ];
    const result = computeCustomerState(orders, config, now);
    expect(result.revenue).toBe(900);
    expect(result.aov).toBe(450);
    expect(result.orderCount).toBe(2);
  });

  it("ranks favourite products by line frequency, alphabetically tie-broken, capped at 3", () => {
    const orders = [
      order("2026-08-01T00:00:00Z", [
        { productName: "Chausa Mango", value: 100 },
        { productName: "Banana", value: 50 },
      ]),
      order("2026-08-03T00:00:00Z", [{ productName: "Chausa Mango", value: 100 }]),
      order("2026-08-05T00:00:00Z", [
        { productName: "Papaya", value: 80 },
        { productName: "Kiwi", value: 60 },
      ]),
    ];
    const result = computeCustomerState(orders, config, now);
    // Chausa Mango: 2, then Banana/Kiwi/Papaya tied at 1 -> alphabetical
    expect(result.favouriteProducts).toEqual(["Chausa Mango", "Banana", "Kiwi"]);
  });

  it("takes last_order_products from only the most recent order, deduped", () => {
    const orders = [
      order("2026-08-01T00:00:00Z", [{ productName: "Banana", value: 50 }]),
      order("2026-08-10T00:00:00Z", [
        { productName: "Chausa Mango", value: 100 },
        { productName: "Chausa Mango", value: 100 },
      ]),
    ];
    const result = computeCustomerState(orders, config, now);
    expect(result.lastOrderProducts).toEqual(["Chausa Mango"]);
  });

  it("is order-input-order independent (sorts by placed_at internally)", () => {
    const later = order("2026-08-10T00:00:00Z", [{ productName: "Kiwi", value: 60 }]);
    const earlier = order("2026-08-01T00:00:00Z", [{ productName: "Banana", value: 50 }]);
    const result = computeCustomerState([later, earlier], config, now);
    expect(result.firstOrderAt).toEqual(earlier.placedAt);
    expect(result.lastOrderAt).toEqual(later.placedAt);
    expect(result.lastOrderProducts).toEqual(["Kiwi"]);
  });
});
