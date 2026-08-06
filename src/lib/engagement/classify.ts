// CLAUDE_engagement_engine_FINAL.md §1/§4: per-customer state classification.
// Pure, deterministic, non-LLM (the spec's "rules decide WHO and WHY") --
// this is money-adjacent logic (drives revenue/VIP/severity) so it's built
// and tested the same way as src/lib/billing/*, not left as inline SQL.
//
// Callers are responsible for excluding cancelled orders before building
// EngagementOrderInput[] (§1: "Exclude orders.status = 'cancelled' from all
// state, cadence, and value math") -- this module has no notion of order
// status at all.

import type { EngagementConfig } from "./config";

export type EngagementState =
  | "prospect"
  | "first_timer"
  | "second_order_risk"
  | "third_order_risk"
  | "lapsed"
  | "breaking"
  | "drifting"
  | "habituated";

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

// §1: "Line value = coalesce(actual_qty, ordered_qty) x locked_price_per_unit
// ... Lines with null locked_price_per_unit contribute 0 to value (unpriced)
// but still count as order activity."
export function lineValue(
  actualQty: number | null,
  orderedQty: number | null,
  lockedPricePerUnit: number | null,
): number {
  const qty = actualQty ?? orderedQty ?? 0;
  const price = lockedPricePerUnit ?? 0;
  return qty * price;
}

export interface EngagementOrderLineInput {
  productName: string;
  value: number; // pre-computed via lineValue()
}

export interface EngagementOrderInput {
  placedAt: Date;
  lines: EngagementOrderLineInput[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const MS_PER_DAY = 86_400_000;

// §4: expected_gap_days = median gap between consecutive orders (>=2 orders)
// or the cohort default (<2 orders). Floored at 0.1d so a same-day repeat
// order can't collapse the median to ~0 and blow severity_ratio up to a
// meaningless number.
export function computeExpectedGapDays(sortedPlacedAt: Date[], config: EngagementConfig): number {
  if (sortedPlacedAt.length < 2) return config.cohortDefaultGapDays;

  const gaps = sortedPlacedAt.slice(1).map((d, i) => (d.getTime() - sortedPlacedAt[i].getTime()) / MS_PER_DAY);
  const med = median(gaps) ?? config.cohortDefaultGapDays;
  return Math.max(med, 0.1);
}

// §4 classify(): order matters -- first matching branch wins, mirrored here
// with the same top-to-bottom if-chain as the spec's decision tree.
export function classifyState(
  input: { orderCount: number; daysSinceLast: number | null; severityRatio: number | null },
  config: EngagementConfig,
): EngagementState {
  const { orderCount } = input;
  if (orderCount === 0) return "prospect";

  const days = input.daysSinceLast ?? 0;
  const severity = input.severityRatio ?? 0;

  if (orderCount === 1 && days < config.secondOrderGraceDays) return "first_timer";
  if (orderCount === 1 && days >= config.secondOrderGraceDays) return "second_order_risk";

  if (
    orderCount === 2 &&
    days >= config.thirdOrderGraceDays &&
    days < config.lapsedAbsoluteDays &&
    severity < config.driftSeverityHigh
  ) {
    return "third_order_risk";
  }

  if (days >= config.lapsedAbsoluteDays || severity >= config.driftSeverityHigh) return "lapsed";
  if (severity >= config.driftSeverityMid) return "breaking";
  if (severity >= config.driftSeverityLow) return "drifting";
  return "habituated";
}

export interface CustomerStateComputation {
  orderCount: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  daysSinceLast: number | null;
  expectedGapDays: number | null;
  severityRatio: number | null;
  revenue: number;
  aov: number;
  favouriteProducts: string[];
  lastOrderProducts: string[];
  state: EngagementState;
}

// §2/§4: the full per-customer row (minus revenue_percentile/is_vip, which
// are population-level -- see priority.ts). `orders` must already exclude
// cancelled orders and carry pre-computed line values (lineValue() above).
export function computeCustomerState(
  orders: EngagementOrderInput[],
  config: EngagementConfig,
  now: Date,
): CustomerStateComputation {
  if (orders.length === 0) {
    return {
      orderCount: 0,
      firstOrderAt: null,
      lastOrderAt: null,
      daysSinceLast: null,
      expectedGapDays: null,
      severityRatio: null,
      revenue: 0,
      aov: 0,
      favouriteProducts: [],
      lastOrderProducts: [],
      state: "prospect",
    };
  }

  const sorted = [...orders].sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime());
  const orderCount = sorted.length;
  const firstOrderAt = sorted[0].placedAt;
  const lastOrderAt = sorted[orderCount - 1].placedAt;

  const daysSinceLast = Math.floor((now.getTime() - lastOrderAt.getTime()) / MS_PER_DAY);
  const expectedGapDays = computeExpectedGapDays(
    sorted.map((o) => o.placedAt),
    config,
  );
  const severityRatio = daysSinceLast / expectedGapDays;

  const revenue = roundToCents(sorted.reduce((sum, o) => sum + o.lines.reduce((s, l) => s + l.value, 0), 0));
  const aov = roundToCents(revenue / orderCount);

  const freq = new Map<string, number>();
  for (const o of sorted) {
    for (const l of o.lines) freq.set(l.productName, (freq.get(l.productName) ?? 0) + 1);
  }
  const favouriteProducts = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([name]) => name);

  const lastOrderProducts = [...new Set(sorted[orderCount - 1].lines.map((l) => l.productName))];

  const state = classifyState({ orderCount, daysSinceLast, severityRatio }, config);

  return {
    orderCount,
    firstOrderAt,
    lastOrderAt,
    daysSinceLast,
    expectedGapDays,
    severityRatio,
    revenue,
    aov,
    favouriteProducts,
    lastOrderProducts,
    state,
  };
}
