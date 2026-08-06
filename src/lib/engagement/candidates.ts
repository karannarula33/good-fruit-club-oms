// CLAUDE_engagement_engine_FINAL.md §5 STEP 3 (candidate generation),
// scoped per §13 slice 3: "eng_nudge_queue + STEP 3 + STEP 5 for two
// triggers only (breaking, third_order_risk) -- rationale-only cards, no
// drafts yet." §6 suppression and full §7 action modulation (lapsed/call
// escalation, unanswered follow-up annotation, frequency cap) are
// explicitly slice 5 work per the build order -- the only §7 rule applied
// here is the base no-phone case, since every candidate needs a real
// recommended_action to write to the queue.

import type { EngagementState } from "./classify";
import { computePriorityScore, type TriggerType } from "./priority";
import { buildRationale } from "./rationale";

export const ACTIVE_TRIGGERS: readonly EngagementState[] = ["breaking", "third_order_risk"];

export interface CandidateSourceInput {
  customerId: string;
  state: EngagementState;
  phone: string | null;
  isVip: boolean;
  revenuePercentile: number;
  orderCount: number;
  daysSinceLast: number | null;
  expectedGapDays: number | null;
  severityRatio: number | null;
}

export interface GeneratedCandidate {
  customerId: string;
  triggerType: TriggerType;
  recommendedAction: "message" | "skip_no_phone";
  priorityScore: number;
  rationale: string;
}

export function generateCandidate(input: CandidateSourceInput): GeneratedCandidate | null {
  if (!ACTIVE_TRIGGERS.includes(input.state)) return null;

  const recommendedAction = input.phone ? "message" : "skip_no_phone";
  const priorityScore = computePriorityScore(input.state, input.isVip, input.revenuePercentile);
  const rationale = buildRationale({
    state: input.state,
    vipCheckin: false, // vip_checkin isn't in ACTIVE_TRIGGERS this slice
    orderCount: input.orderCount,
    daysSinceLast: input.daysSinceLast,
    expectedGapDays: input.expectedGapDays,
    severityRatio: input.severityRatio,
  });

  return { customerId: input.customerId, triggerType: input.state, recommendedAction, priorityScore, rationale };
}
