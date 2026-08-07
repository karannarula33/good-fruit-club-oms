// CLAUDE_engagement_engine_FINAL.md §5 STEP 3 + STEP 4 + STEP 5, scoped per
// §13 slice 4 to two triggers (breaking, third_order_risk). Reads
// eng_customer_state (already fresh from this run's STEP 1) and inserts
// pending eng_nudge_queue rows, drafted (§9) for every `message` candidate.
// Idempotent within a day: re-running the pipeline (or the admin's manual
// recompute) on the same IST calendar date won't create a second row for a
// customer already queued today.
//
// Cross-day accumulation (a still-breaking customer getting a fresh row
// every day they're never actioned) is expected at this slice -- §0.1
// explicitly re-surfaces a still-triggering customer every day regardless
// of nudge history, and the frequency-cap suppression that dampens this is
// slice 5 (§6) work, not yet built.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, NudgeRecommendedAction } from "@/lib/supabase/database.types";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { ACTIVE_TRIGGERS, generateCandidate, type GeneratedCandidate } from "./candidates";
import type { EngagementState } from "./classify";
import { draftNudgeMessage } from "./draft";
import { loadTodaysCatalogueHighlights } from "./catalogue-highlights";

type Client = SupabaseClient<Database>;

export interface QueueGenerationSummary {
  candidatesGenerated: number;
  skippedAlreadyQueuedToday: number;
  draftsGenerated: number;
  draftFailures: number;
}

interface QueueRow {
  run_date: string;
  customer_id: string;
  trigger_type: string;
  recommended_action: NudgeRecommendedAction;
  priority_score: number;
  rationale: string;
  draft_message: string | null;
  draft_rationale: string | null;
  status: "pending";
}

interface CandidateContext {
  candidate: GeneratedCandidate;
  displayName: string;
  zone: string;
  orderCount: number;
  favouriteProducts: string[];
  lastOrderProducts: string[];
}

const DRAFT_CONCURRENCY = 5;

// STEP 4 (§9): 'call' and 'skip_no_phone' get rationale only, no draft --
// only 'message' candidates get drafted. Failures are caught per-candidate
// so one bad Claude call can't block the whole run; a failed draft just
// falls back to the rationale-only card slice 3 already ships.
async function draftForCandidates(
  contexts: CandidateContext[],
  todaysCatalogueHighlights: string[],
  seasonalNote: string | null,
): Promise<Map<string, { draftMessage: string; draftRationale: string }>> {
  const results = new Map<string, { draftMessage: string; draftRationale: string }>();
  const toDraft = contexts.filter((c) => c.candidate.recommendedAction === "message");

  for (let i = 0; i < toDraft.length; i += DRAFT_CONCURRENCY) {
    const batch = toDraft.slice(i, i + DRAFT_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((ctx) =>
        draftNudgeMessage({
          customerName: ctx.displayName,
          zone: ctx.zone,
          triggerType: ctx.candidate.triggerType,
          isFollowup: false, // real follow-up detection is §7, slice 5
          rationale: ctx.candidate.rationale,
          orderCount: ctx.orderCount,
          lastOrderProducts: ctx.lastOrderProducts,
          favouriteProducts: ctx.favouriteProducts,
          todaysCatalogueHighlights,
          seasonalNote,
        }),
      ),
    );
    settled.forEach((outcome, j) => {
      if (outcome.status === "fulfilled") {
        results.set(batch[j].candidate.customerId, outcome.value);
      } else {
        console.error(`Nudge draft failed for customer ${batch[j].candidate.customerId}:`, outcome.reason);
      }
    });
  }

  return results;
}

export async function runQueueGeneration(supabase: Client): Promise<QueueGenerationSummary> {
  const runDate = utcToIstDatetimeLocal(new Date()).slice(0, 10);

  const { data: states, error: statesError } = await supabase
    .from("eng_customer_state")
    .select(
      "customer_id, state, is_vip, revenue_percentile, order_count, days_since_last, expected_gap_days, severity_ratio, favourite_products, last_order_products",
    )
    .in("state", ACTIVE_TRIGGERS as string[]);
  if (statesError) throw new Error(`Failed to load eng_customer_state: ${statesError.message}`);
  if (!states || states.length === 0) {
    return { candidatesGenerated: 0, skippedAlreadyQueuedToday: 0, draftsGenerated: 0, draftFailures: 0 };
  }

  const customerIds = states.map((s) => s.customer_id);
  const { data: customers, error: customersError } = await supabase
    .from("customers")
    .select("id, phone, display_name, zone")
    .in("id", customerIds);
  if (customersError) throw new Error(`Failed to load customers: ${customersError.message}`);
  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));

  const { data: existingToday, error: existingError } = await supabase
    .from("eng_nudge_queue")
    .select("customer_id")
    .eq("run_date", runDate);
  if (existingError) throw new Error(`Failed to load today's eng_nudge_queue rows: ${existingError.message}`);
  const alreadyQueuedToday = new Set((existingToday ?? []).map((r) => r.customer_id));

  const { data: settingsRow, error: settingsError } = await supabase
    .from("eng_settings")
    .select("seasonal_note")
    .eq("id", 1)
    .maybeSingle();
  if (settingsError) throw new Error(`Failed to load eng_settings: ${settingsError.message}`);
  const seasonalNote = settingsRow?.seasonal_note ?? null;

  const todaysCatalogueHighlights = await loadTodaysCatalogueHighlights(supabase);

  const contexts: CandidateContext[] = [];
  let skipped = 0;

  for (const s of states) {
    if (alreadyQueuedToday.has(s.customer_id)) {
      skipped++;
      continue;
    }
    const customer = customerById.get(s.customer_id);
    const candidate = generateCandidate({
      customerId: s.customer_id,
      state: s.state as EngagementState,
      phone: customer?.phone ?? null,
      isVip: s.is_vip ?? false,
      revenuePercentile: s.revenue_percentile ?? 0,
      orderCount: s.order_count,
      daysSinceLast: s.days_since_last,
      expectedGapDays: s.expected_gap_days,
      severityRatio: s.severity_ratio,
    });
    if (!candidate) continue;

    contexts.push({
      candidate,
      displayName: customer?.display_name ?? "",
      zone: customer?.zone ?? "",
      orderCount: s.order_count,
      favouriteProducts: s.favourite_products ?? [],
      lastOrderProducts: s.last_order_products ?? [],
    });
  }

  const drafts = await draftForCandidates(contexts, todaysCatalogueHighlights, seasonalNote);

  const rows: QueueRow[] = contexts.map((ctx) => {
    const draft = drafts.get(ctx.candidate.customerId);
    return {
      run_date: runDate,
      customer_id: ctx.candidate.customerId,
      trigger_type: ctx.candidate.triggerType,
      recommended_action: ctx.candidate.recommendedAction,
      priority_score: ctx.candidate.priorityScore,
      rationale: ctx.candidate.rationale,
      draft_message: draft?.draftMessage ?? null,
      draft_rationale: draft?.draftRationale ?? null,
      status: "pending",
    };
  });

  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from("eng_nudge_queue").insert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(`Failed to insert eng_nudge_queue chunk ${i}: ${error.message}`);
  }

  const messagesAttempted = contexts.filter((c) => c.candidate.recommendedAction === "message").length;

  return {
    candidatesGenerated: rows.length,
    skippedAlreadyQueuedToday: skipped,
    draftsGenerated: drafts.size,
    draftFailures: messagesAttempted - drafts.size,
  };
}
