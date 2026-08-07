// CLAUDE_engagement_engine_FINAL.md §5 STEP 3 (candidate generation), full
// scope per §13 slice 5: all five order-driven triggers plus the
// vip_checkin flag, §7 action modulation, and §6 suppression as the final
// gate. One customer -> at most one candidate: resolve the trigger, apply
// suppression, apply modulation, done.

import type { EngagementState } from "./classify";
import { computePriorityScore, type TriggerType } from "./priority";
import { buildRationale } from "./rationale";
import { modulateAction, type LastRelayedMessage } from "./modulate";
import { evaluateSuppression } from "./suppression";
import type { EngagementConfig } from "./config";

export const ACTIVE_TRIGGERS: readonly EngagementState[] = [
  "second_order_risk",
  "third_order_risk",
  "drifting",
  "breaking",
  "lapsed",
];

const FOLLOWUP_ANNOTATION = " (follow-up -- prior message unanswered)";

// §4: a customer's trigger is either their order-driven state (if it's one
// of the five above) or the vip_checkin flag layered on `habituated` --
// never both, since vip_checkin requires state === 'habituated' exactly,
// which is itself never in ACTIVE_TRIGGERS. Centralised here so
// generate-queue.ts's pre-filter (who even needs a history lookup) and
// generateCandidate's own trigger resolution never drift apart.
export function determineTrigger(state: EngagementState, vipCheckin: boolean): TriggerType | null {
  if (ACTIVE_TRIGGERS.includes(state)) return state;
  if (vipCheckin) return "vip_checkin";
  return null;
}

export interface CandidateSourceInput {
  customerId: string;
  state: EngagementState;
  vipCheckin: boolean;
  phone: string | null;
  isVip: boolean;
  revenuePercentile: number;
  orderCount: number;
  daysSinceLast: number | null;
  expectedGapDays: number | null;
  severityRatio: number | null;
  lastRelayedMessage: LastRelayedMessage | null;
  hasActiveSuppression: boolean;
  unansweredCount60d: number;
  lastRelayedAnyAt: Date | null;
  now: Date;
}

export interface GeneratedCandidate {
  customerId: string;
  triggerType: TriggerType;
  recommendedAction: "message" | "call" | "skip_no_phone";
  priorityScore: number;
  rationale: string;
  isFollowup: boolean;
}

export type CandidateResolution =
  | { kind: "candidate"; candidate: GeneratedCandidate }
  | { kind: "suppressed"; autoInsertTwoUnanswered: boolean }
  | { kind: "no_trigger" };

export function generateCandidate(input: CandidateSourceInput, config: EngagementConfig): CandidateResolution {
  const trigger = determineTrigger(input.state, input.vipCheckin);
  if (!trigger) return { kind: "no_trigger" };

  // §5 STEP 3's own order: "determine recommended_action via §7 ... apply
  // suppression (§6). Suppressed -> no candidate." -- modulation runs
  // first even though its result isn't itself an input to the suppression
  // decision, so a suppressed customer is filtered out regardless of what
  // action they would have gotten (including skip_no_phone).
  const modulation = modulateAction(
    { state: input.state, phone: input.phone, lastRelayedMessage: input.lastRelayedMessage, now: input.now },
    config,
  );

  const suppression = evaluateSuppression(
    {
      hasActiveSuppression: input.hasActiveSuppression,
      unansweredCount60d: input.unansweredCount60d,
      lastRelayedAnyAt: input.lastRelayedAnyAt,
      now: input.now,
    },
    config,
  );
  if (suppression.suppressed) {
    return { kind: "suppressed", autoInsertTwoUnanswered: suppression.autoInsertTwoUnanswered };
  }

  const priorityScore = computePriorityScore(trigger, input.isVip, input.revenuePercentile);
  const rationale =
    buildRationale({
      state: input.state,
      vipCheckin: input.vipCheckin,
      orderCount: input.orderCount,
      daysSinceLast: input.daysSinceLast,
      expectedGapDays: input.expectedGapDays,
      severityRatio: input.severityRatio,
    }) + (modulation.followupAnnotation ? FOLLOWUP_ANNOTATION : "");

  return {
    kind: "candidate",
    candidate: {
      customerId: input.customerId,
      triggerType: trigger,
      recommendedAction: modulation.recommendedAction,
      priorityScore,
      rationale,
      isFollowup: modulation.isFollowup,
    },
  };
}
