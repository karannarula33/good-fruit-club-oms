// CLAUDE_engagement_engine_FINAL.md §0.3/§5 STEP 2: "Outcomes... are derived
// by re-reading orders on later runs. The only human actions are approve /
// edit / skip in the queue." No manual logging, ever -- this is the sole
// source of "did nudges work" (§5).
//
// "Reorder" = the customer's earliest non-cancelled order placed strictly
// after the nudge was relayed. Later orders in the window don't change
// whether the nudge worked -- the first one is the causal signal.

const MS_PER_DAY = 86_400_000;

export interface OutcomeOrderInput {
  id: string;
  placedAt: Date;
}

export interface OutcomeResult {
  reorderedWithin7d: boolean;
  reorderedWithin14d: boolean;
  reorderOrderId: string | null;
  daysToReorder: number | null;
}

export function evaluateNudgeOutcome(relayedAt: Date, customerOrders: OutcomeOrderInput[]): OutcomeResult {
  const candidates = customerOrders
    .filter((o) => o.placedAt.getTime() > relayedAt.getTime())
    .sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime());

  if (candidates.length === 0) {
    return { reorderedWithin7d: false, reorderedWithin14d: false, reorderOrderId: null, daysToReorder: null };
  }

  const first = candidates[0];
  const daysToReorder = Math.floor((first.placedAt.getTime() - relayedAt.getTime()) / MS_PER_DAY);

  return {
    reorderedWithin7d: daysToReorder <= 7,
    reorderedWithin14d: daysToReorder <= 14,
    reorderOrderId: first.id,
    daysToReorder,
  };
}
