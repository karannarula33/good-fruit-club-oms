// CLAUDE_engagement_engine_FINAL.md §5: the nightly pipeline. STEP 1 and
// STEP 2 only for now (slices 1-2) -- STEP 3-5 (candidate generation,
// drafting, queueing) land in later slices and will extend this function,
// not replace it.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { runEngagementRecompute, type RecomputeSummary } from "./recompute";
import { runOutcomeEvaluation, type OutcomeEvaluationSummary } from "./evaluate-outcomes";

type Client = SupabaseClient<Database>;

export interface PipelineSummary {
  state: RecomputeSummary;
  outcomes: OutcomeEvaluationSummary;
}

export async function runEngagementPipeline(supabase: Client): Promise<PipelineSummary> {
  const state = await runEngagementRecompute(supabase);
  const outcomes = await runOutcomeEvaluation(supabase);
  return { state, outcomes };
}
