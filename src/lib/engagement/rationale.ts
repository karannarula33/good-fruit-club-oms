// CLAUDE_engagement_engine_FINAL.md §0.4: "Every nudge carries a one-sentence
// human rationale. If it reads as a stretch, the threshold is miscalibrated
// -- fix the rule, don't send the message." Shared by candidate generation
// (written once into eng_nudge_queue.rationale) and the read-only state
// browse view (computed live, since it covers customers with no queue row).

import type { EngagementState } from "./classify";

export interface RationaleInput {
  state: EngagementState;
  vipCheckin: boolean;
  orderCount: number;
  daysSinceLast: number | null;
  expectedGapDays: number | null;
  severityRatio: number | null;
}

export function buildRationale(input: RationaleInput): string {
  if (input.vipCheckin) return `VIP, on rhythm, silent ${input.daysSinceLast}d.`;
  if (input.state === "prospect") return "No orders yet.";
  if (input.state === "first_timer") return `1 order, ${input.daysSinceLast}d ago -- still within grace.`;
  if (input.severityRatio === null || input.expectedGapDays === null || input.daysSinceLast === null) {
    return `${input.orderCount} orders, silent so far.`;
  }
  const gap = input.expectedGapDays < 10 ? input.expectedGapDays.toFixed(1) : String(Math.round(input.expectedGapDays));
  return `Orders every ~${gap}d, silent ${input.daysSinceLast}d (${input.severityRatio.toFixed(1)}x).`;
}
