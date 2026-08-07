// CLAUDE_engagement_engine_FINAL.md §7: "The customer is already surfaced
// by order data. This step decides the *action*, taking prior nudges as
// one input. It never un-surfaces a customer." Pure, unit-tested --
// mirrors classify.ts's role for §4.
//
// Transcribed from §7's modulate() pseudocode exactly, including a
// non-obvious consequence of its if/else structure: the `lapsed` branch
// *always* returns (call if unanswered within 21d, else plain message),
// so the "general escalation" 14d-unanswered check below it is normally
// unreachable for `lapsed` -- it only reaches `breaking` in practice.
// The one exception is when CALL_ESCALATION_ENABLED is off: then the
// lapsed branch is skipped entirely and a `lapsed` customer correctly
// falls through to the general check too, which is why that check's
// state test still includes 'lapsed' (matching the spec's literal
// `current state in ('breaking','lapsed')`) even though it's normally
// dead for lapsed customers.

import type { EngagementConfig } from "./config";
import type { EngagementState } from "./classify";

export interface LastRelayedMessage {
  relayedAt: Date;
  // null = outcome not yet evaluated (shouldn't happen for anything old
  // enough to matter here, since STEP 2 runs immediately before this in
  // the same pipeline call and evaluates anything relayed >=7d ago).
  reorderedWithin14d: boolean | null;
}

export interface ModulationInput {
  state: EngagementState;
  phone: string | null;
  lastRelayedMessage: LastRelayedMessage | null;
  now: Date;
}

export interface ModulationResult {
  recommendedAction: "message" | "call" | "skip_no_phone";
  isFollowup: boolean; // tells the draft agent this is a second touch (§9)
  followupAnnotation: boolean; // append "(follow-up -- prior message unanswered)" to the rationale
}

const MS_PER_DAY = 86_400_000;

function daysSince(then: Date, now: Date): number {
  return Math.floor((now.getTime() - then.getTime()) / MS_PER_DAY);
}

function wasUnanswered(lastRelayedMessage: LastRelayedMessage | null): boolean {
  return lastRelayedMessage !== null && lastRelayedMessage.reorderedWithin14d === false;
}

export function modulateAction(input: ModulationInput, config: EngagementConfig): ModulationResult {
  if (!input.phone) {
    return { recommendedAction: "skip_no_phone", isFollowup: false, followupAnnotation: false };
  }

  const unanswered = wasUnanswered(input.lastRelayedMessage);
  const daysSinceLastMessage = input.lastRelayedMessage ? daysSince(input.lastRelayedMessage.relayedAt, input.now) : null;

  if (input.state === "lapsed" && config.callEscalationEnabled) {
    if (unanswered && daysSinceLastMessage !== null && daysSinceLastMessage <= 21) {
      return { recommendedAction: "call", isFollowup: false, followupAnnotation: true };
    }
    return { recommendedAction: "message", isFollowup: false, followupAnnotation: false };
  }

  if (
    (input.state === "breaking" || input.state === "lapsed") &&
    unanswered &&
    daysSinceLastMessage !== null &&
    daysSinceLastMessage >= 14
  ) {
    return { recommendedAction: "message", isFollowup: true, followupAnnotation: true };
  }

  return { recommendedAction: "message", isFollowup: false, followupAnnotation: false };
}
