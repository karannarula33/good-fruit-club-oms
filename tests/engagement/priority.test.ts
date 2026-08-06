import { describe, expect, it } from "vitest";
import { attachRevenuePercentiles, computePercentRanks, computePriorityScore, isVipCheckin } from "@/lib/engagement/priority";
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
]);

describe("computePercentRanks", () => {
  it("returns 0 for a single value", () => {
    expect(computePercentRanks([500])).toEqual([0]);
  });

  it("returns 0 for an empty list", () => {
    expect(computePercentRanks([])).toEqual([]);
  });

  it("matches Postgres percent_rank() for distinct values: (rank - 1) / (n - 1)", () => {
    // 4 values -> ranks 1..4 -> percentiles 0, 1/3, 2/3, 1
    expect(computePercentRanks([100, 400, 200, 300])).toEqual([0, 1, 1 / 3, 2 / 3]);
  });

  it("gives tied values the rank of the first row in the tie group", () => {
    // sorted: 100, 200, 200, 400 -> ranks 1, 2, 2, 4 -> percentiles 0, 1/3, 1/3, 1
    expect(computePercentRanks([200, 400, 100, 200])).toEqual([1 / 3, 1, 0, 1 / 3]);
  });

  it("gives every customer the same (lowest) percentile when all revenue is equal", () => {
    expect(computePercentRanks([50, 50, 50])).toEqual([0, 0, 0]);
  });
});

describe("attachRevenuePercentiles", () => {
  it("flags the top decile as VIP and nobody else", () => {
    const states = Array.from({ length: 10 }, (_, i) => ({ revenue: (i + 1) * 100 }));
    const result = attachRevenuePercentiles(states, config);
    // top value has percentile 1 (>= 0.9) -> VIP; next one down is 8/9 ≈ 0.889 -> not VIP
    expect(result.filter((r) => r.isVip)).toHaveLength(1);
    expect(result[9].isVip).toBe(true);
    expect(result[8].isVip).toBe(false);
  });

  it("nobody is VIP when there's only one customer (percentile always 0)", () => {
    const result = attachRevenuePercentiles([{ revenue: 10_000 }], config);
    expect(result[0].isVip).toBe(false);
    expect(result[0].revenuePercentile).toBe(0);
  });
});

describe("computePriorityScore", () => {
  it("gives lapsed VIP customers the top base score of 100", () => {
    expect(computePriorityScore("lapsed", true, 0)).toBe(100);
  });

  it("gives lapsed non-VIP customers a base score of 90", () => {
    expect(computePriorityScore("lapsed", false, 0)).toBe(90);
  });

  it("adds revenue percentile as a tiebreaker within a tier", () => {
    expect(computePriorityScore("breaking", false, 0.5)).toBe(80); // 70 + 0.5*20
  });

  it("gives non-triggering states (habituated/first_timer/prospect) a floor of the revenue bonus only", () => {
    expect(computePriorityScore("habituated", false, 0.5)).toBe(10);
  });

  it("gives vip_checkin a base score of 50, between second_order_risk and drifting", () => {
    expect(computePriorityScore("vip_checkin", true, 0)).toBe(50);
  });
});

describe("isVipCheckin", () => {
  it("is true for a VIP, habituated, silent-past-interval customer", () => {
    expect(isVipCheckin({ state: "habituated", isVip: true, daysSinceLast: 10 }, config)).toBe(true);
  });

  it("is false for a non-VIP habituated customer, regardless of days silent", () => {
    expect(isVipCheckin({ state: "habituated", isVip: false, daysSinceLast: 20 }, config)).toBe(false);
  });

  it("is false for a VIP customer who isn't habituated (e.g. already breaking)", () => {
    expect(isVipCheckin({ state: "breaking", isVip: true, daysSinceLast: 20 }, config)).toBe(false);
  });

  it("is false for a VIP habituated customer still within the check-in interval", () => {
    expect(isVipCheckin({ state: "habituated", isVip: true, daysSinceLast: 9 }, config)).toBe(false);
  });

  it("is false when daysSinceLast is null (no orders yet)", () => {
    expect(isVipCheckin({ state: "habituated", isVip: true, daysSinceLast: null }, config)).toBe(false);
  });
});
