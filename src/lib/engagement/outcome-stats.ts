// Groundwork for CLAUDE_engagement_engine_FINAL.md §13 slice 6 ("tune §3
// constants from accumulated outcome data"): a per-trigger-type breakdown
// of eng_nudge_outcomes so the numbers needed to actually tune those
// constants are visible on the page rather than a one-off SQL query.
// Purely an instrument -- this never writes eng_config itself.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export interface OutcomeStatsInputRow {
  triggerType: string;
  evaluated: boolean; // has a matching eng_nudge_outcomes row (relayed >=7d ago)
  reorderedWithin7d: boolean | null;
  reorderedWithin14d: boolean | null;
  daysToReorder: number | null;
}

export interface OutcomeStatsRow {
  triggerType: string;
  relayedCount: number;
  evaluatedCount: number;
  pendingCount: number; // relayed but too recent to have an outcome yet
  reorderedWithin7dRate: number | null; // fraction of evaluatedCount, null if 0 evaluated
  reorderedWithin14dRate: number | null;
  avgDaysToReorder: number | null; // mean over rows that did reorder
}

// Same fixed order §8's badge rows already use (engagement-list.tsx,
// nudge-queue.tsx) -- keeps this table's row order consistent with the
// rest of the page rather than an arbitrary DB-return order.
const TRIGGER_ORDER = ["lapsed", "breaking", "third_order_risk", "second_order_risk", "vip_checkin", "drifting"];

function triggerSortKey(triggerType: string): number {
  const index = TRIGGER_ORDER.indexOf(triggerType);
  return index === -1 ? TRIGGER_ORDER.length : index;
}

export function computeOutcomeStats(rows: OutcomeStatsInputRow[]): OutcomeStatsRow[] {
  const byTrigger = new Map<string, OutcomeStatsInputRow[]>();
  for (const row of rows) {
    const bucket = byTrigger.get(row.triggerType) ?? [];
    bucket.push(row);
    byTrigger.set(row.triggerType, bucket);
  }

  const result: OutcomeStatsRow[] = [];
  for (const [triggerType, group] of byTrigger) {
    const relayedCount = group.length;
    const evaluated = group.filter((r) => r.evaluated);
    const evaluatedCount = evaluated.length;
    const pendingCount = relayedCount - evaluatedCount;

    const reordered7dCount = evaluated.filter((r) => r.reorderedWithin7d === true).length;
    const reordered14dCount = evaluated.filter((r) => r.reorderedWithin14d === true).length;
    const daysToReorderValues = evaluated
      .map((r) => r.daysToReorder)
      .filter((d): d is number => d !== null);

    result.push({
      triggerType,
      relayedCount,
      evaluatedCount,
      pendingCount,
      reorderedWithin7dRate: evaluatedCount > 0 ? reordered7dCount / evaluatedCount : null,
      reorderedWithin14dRate: evaluatedCount > 0 ? reordered14dCount / evaluatedCount : null,
      avgDaysToReorder:
        daysToReorderValues.length > 0
          ? daysToReorderValues.reduce((sum, d) => sum + d, 0) / daysToReorderValues.length
          : null,
    });
  }

  return result.sort((a, b) => triggerSortKey(a.triggerType) - triggerSortKey(b.triggerType) || a.triggerType.localeCompare(b.triggerType));
}

export async function loadOutcomeStats(supabase: Client): Promise<OutcomeStatsRow[]> {
  const { data: relayed, error: relayedError } = await supabase
    .from("eng_nudge_queue")
    .select("id, trigger_type")
    .eq("status", "relayed");
  if (relayedError) throw new Error(`Failed to load relayed eng_nudge_queue rows: ${relayedError.message}`);
  if (!relayed || relayed.length === 0) return [];

  const { data: outcomes, error: outcomesError } = await supabase
    .from("eng_nudge_outcomes")
    .select("nudge_id, reordered_within_7d, reordered_within_14d, days_to_reorder")
    .in(
      "nudge_id",
      relayed.map((r) => r.id),
    );
  if (outcomesError) throw new Error(`Failed to load eng_nudge_outcomes: ${outcomesError.message}`);
  const outcomeByNudgeId = new Map((outcomes ?? []).map((o) => [o.nudge_id, o]));

  const inputRows: OutcomeStatsInputRow[] = relayed.map((r) => {
    const outcome = outcomeByNudgeId.get(r.id);
    return {
      triggerType: r.trigger_type,
      evaluated: outcome !== undefined,
      reorderedWithin7d: outcome?.reordered_within_7d ?? null,
      reorderedWithin14d: outcome?.reordered_within_14d ?? null,
      daysToReorder: outcome?.days_to_reorder ?? null,
    };
  });

  return computeOutcomeStats(inputRows);
}
