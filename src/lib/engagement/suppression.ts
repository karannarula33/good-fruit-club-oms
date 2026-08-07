// CLAUDE_engagement_engine_FINAL.md §6: "Skip if ANY holds" -- checked
// after §7 modulation decides an action, as a final gate that can drop the
// candidate entirely (STEP 3: "apply suppression (§6). Suppressed -> no
// candidate."). Pure, unit-tested, same role as modulate.ts for §7.
//
// Complaint suppression has no automatic signal in the base schema (§6/
// §14.2) -- it's manual-insert-only, and is already covered here once a
// row exists: `hasActiveSuppression` doesn't distinguish reasons, it's
// just "is there any non-expired eng_suppression row for this customer."

import type { EngagementConfig } from "./config";

export interface SuppressionInput {
  hasActiveSuppression: boolean; // any non-expired eng_suppression row (any reason)
  unansweredCount60d: number; // relayed nudges in the trailing 60d with an evaluated, no-reorder outcome
  lastRelayedAnyAt: Date | null; // most recent relay of any action type (message or call)
  now: Date;
}

export interface SuppressionResult {
  suppressed: boolean;
  // true when unansweredCount60d just crossed the threshold this run --
  // the caller is responsible for auto-inserting the two_unanswered row
  // (30-day expiry per §6), this function only decides whether to.
  autoInsertTwoUnanswered: boolean;
}

const MS_PER_DAY = 86_400_000;

export function evaluateSuppression(input: SuppressionInput, config: EngagementConfig): SuppressionResult {
  if (input.hasActiveSuppression) {
    return { suppressed: true, autoInsertTwoUnanswered: false };
  }

  if (input.unansweredCount60d >= config.unansweredCooldownCount) {
    return { suppressed: true, autoInsertTwoUnanswered: true };
  }

  if (input.lastRelayedAnyAt) {
    const daysSinceRelay = Math.floor((input.now.getTime() - input.lastRelayedAnyAt.getTime()) / MS_PER_DAY);
    if (daysSinceRelay < config.frequencyCapDays) {
      return { suppressed: true, autoInsertTwoUnanswered: false };
    }
  }

  return { suppressed: false, autoInsertTwoUnanswered: false };
}
