// CLAUDE_engagement_engine_FINAL.md §1/§8: revenue_percentile and is_vip are
// population-level (computed across all customers at once), unlike the rest
// of classify.ts which is per-customer -- kept in a separate module for that
// reason.

import type { EngagementConfig } from "./config";
import type { EngagementState } from "./classify";

// Matches Postgres percent_rank(): tied values share the rank of the first
// row in the tie group; percentile = (rank - 1) / (n - 1), 0 when n <= 1.
export function computePercentRanks(values: number[]): number[] {
  const n = values.length;
  if (n <= 1) return values.map(() => 0);

  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const ranks = new Array<number>(n);

  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[order[j + 1]] === values[order[i]]) j++;
    const percentRank = i / (n - 1);
    for (let k = i; k <= j; k++) ranks[order[k]] = percentRank;
    i = j + 1;
  }
  return ranks;
}

export function attachRevenuePercentiles<T extends { revenue: number }>(
  states: T[],
  config: EngagementConfig,
): (T & { revenuePercentile: number; isVip: boolean })[] {
  const percentiles = computePercentRanks(states.map((s) => s.revenue));
  return states.map((s, i) => ({
    ...s,
    revenuePercentile: percentiles[i],
    isVip: percentiles[i] >= config.vipPercentile,
  }));
}

// §4: vip_checkin is a flag layered on top of `state` (VIP + habituated +
// silent past the check-in interval), not a distinct classify() output --
// but §8's base-priority table scores it as its own trigger, so priority
// scoring works over this wider type rather than EngagementState alone.
export type TriggerType = EngagementState | "vip_checkin";

// §4: is_vip and state=='habituated' and days_since_last >= VIP_CHECKIN_INTERVAL_DAYS.
export function isVipCheckin(
  input: { state: EngagementState; isVip: boolean; daysSinceLast: number | null },
  config: EngagementConfig,
): boolean {
  return (
    input.isVip &&
    input.state === "habituated" &&
    input.daysSinceLast !== null &&
    input.daysSinceLast >= config.vipCheckinIntervalDays
  );
}

// §8: base(trigger) + revenue_percentile * 20.
const BASE_PRIORITY: Record<TriggerType, number> = {
  lapsed: 90,
  breaking: 70,
  third_order_risk: 65,
  second_order_risk: 55,
  vip_checkin: 50,
  drifting: 40,
  habituated: 0,
  first_timer: 0,
  prospect: 0,
};

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computePriorityScore(trigger: TriggerType, isVip: boolean, revenuePercentile: number): number {
  const base = trigger === "lapsed" && isVip ? 100 : BASE_PRIORITY[trigger];
  return roundToCents(base + revenuePercentile * 20);
}
