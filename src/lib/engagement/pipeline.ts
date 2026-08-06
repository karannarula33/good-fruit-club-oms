// CLAUDE_engagement_engine_FINAL.md §5: the nightly pipeline. STEP 1, STEP 2,
// and STEP 3+5 (queue generation, scoped per §13 slice 3 to breaking/
// third_order_risk only -- STEP 4 drafting isn't built yet). Order matters:
// STEP 3 reads eng_customer_state, so it must run after STEP 1 has refreshed
// it this run.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { runEngagementRecompute, type RecomputeSummary } from "./recompute";
import { runOutcomeEvaluation, type OutcomeEvaluationSummary } from "./evaluate-outcomes";
import { runQueueGeneration, type QueueGenerationSummary } from "./generate-queue";

type Client = SupabaseClient<Database>;

export interface PipelineSummary {
  state: RecomputeSummary;
  outcomes: OutcomeEvaluationSummary;
  queue: QueueGenerationSummary;
}

export async function runEngagementPipeline(supabase: Client): Promise<PipelineSummary> {
  const state = await runEngagementRecompute(supabase);
  const outcomes = await runOutcomeEvaluation(supabase);
  const queue = await runQueueGeneration(supabase);
  return { state, outcomes, queue };
}
