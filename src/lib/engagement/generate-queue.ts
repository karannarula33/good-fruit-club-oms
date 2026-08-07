// CLAUDE_engagement_engine_FINAL.md §5 STEP 3 + STEP 4 + STEP 5, full scope
// per §13 slice 5: every order-driven trigger plus vip_checkin, §7 action
// modulation, and §6 suppression as the final gate. Reads eng_customer_state
// (already fresh from this run's STEP 1) and inserts pending eng_nudge_queue
// rows, drafted (§9) for every `message` candidate. Idempotent within a day:
// re-running the pipeline (or the admin's manual recompute) on the same IST
// calendar date won't create a second row for a customer already queued
// today.
//
// Cross-day accumulation (a still-triggering customer getting a fresh row
// every day) is still expected by design (§0.1) for anyone *not* caught by
// §6 suppression -- the frequency cap only kicks in once a nudge has
// actually been relayed to them.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, NudgeRecommendedAction, SuppressionReason } from "@/lib/supabase/database.types";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { ACTIVE_TRIGGERS, determineTrigger, generateCandidate, type GeneratedCandidate } from "./candidates";
import type { EngagementState } from "./classify";
import { buildEngagementConfig } from "./config";
import { isVipCheckin } from "./priority";
import { loadNudgeHistory } from "./nudge-history";
import { draftNudgeMessage } from "./draft";
import { loadTodaysCatalogueHighlights } from "./catalogue-highlights";

type Client = SupabaseClient<Database>;

export interface QueueGenerationSummary {
  candidatesGenerated: number;
  skippedAlreadyQueuedToday: number;
  suppressed: number;
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
const MS_PER_DAY = 86_400_000;

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
          isFollowup: ctx.candidate.isFollowup,
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
  const now = new Date();
  const runDate = utcToIstDatetimeLocal(now).slice(0, 10);
  const empty: QueueGenerationSummary = {
    candidatesGenerated: 0,
    skippedAlreadyQueuedToday: 0,
    suppressed: 0,
    draftsGenerated: 0,
    draftFailures: 0,
  };

  const { data: configRows, error: configError } = await supabase.from("eng_config").select("key, value");
  if (configError) throw new Error(`Failed to load eng_config: ${configError.message}`);
  if (!configRows || configRows.length === 0) return empty;
  const config = buildEngagementConfig(configRows);

  // habituated rows are fetched too -- they're needed to detect the
  // vip_checkin flag (§4), even though habituated itself is never in
  // ACTIVE_TRIGGERS.
  const { data: states, error: statesError } = await supabase
    .from("eng_customer_state")
    .select(
      "customer_id, state, is_vip, revenue_percentile, order_count, days_since_last, expected_gap_days, severity_ratio, favourite_products, last_order_products",
    )
    .in("state", [...ACTIVE_TRIGGERS, "habituated"] as string[]);
  if (statesError) throw new Error(`Failed to load eng_customer_state: ${statesError.message}`);
  if (!states || states.length === 0) return empty;

  const triggering = states.filter((s) => {
    const vipCheckin = isVipCheckin({ state: s.state as EngagementState, isVip: s.is_vip ?? false, daysSinceLast: s.days_since_last }, config);
    return determineTrigger(s.state as EngagementState, vipCheckin) !== null;
  });
  if (triggering.length === 0) return empty;

  const customerIds = triggering.map((s) => s.customer_id);
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

  const pending = triggering.filter((s) => !alreadyQueuedToday.has(s.customer_id));
  const skipped = triggering.length - pending.length;
  if (pending.length === 0) return { ...empty, skippedAlreadyQueuedToday: skipped };

  const history = await loadNudgeHistory(
    supabase,
    pending.map((s) => s.customer_id),
    now,
  );

  const { data: settingsRow, error: settingsError } = await supabase
    .from("eng_settings")
    .select("seasonal_note")
    .eq("id", 1)
    .maybeSingle();
  if (settingsError) throw new Error(`Failed to load eng_settings: ${settingsError.message}`);
  const seasonalNote = settingsRow?.seasonal_note ?? null;

  const todaysCatalogueHighlights = await loadTodaysCatalogueHighlights(supabase);

  const contexts: CandidateContext[] = [];
  const twoUnansweredInserts: { customer_id: string; reason: SuppressionReason; expires_at: string }[] = [];
  let suppressedCount = 0;

  for (const s of pending) {
    const customer = customerById.get(s.customer_id);
    const vipCheckin = isVipCheckin({ state: s.state as EngagementState, isVip: s.is_vip ?? false, daysSinceLast: s.days_since_last }, config);
    const ctx = history.get(s.customer_id);

    const resolution = generateCandidate(
      {
        customerId: s.customer_id,
        state: s.state as EngagementState,
        vipCheckin,
        phone: customer?.phone ?? null,
        isVip: s.is_vip ?? false,
        revenuePercentile: s.revenue_percentile ?? 0,
        orderCount: s.order_count,
        daysSinceLast: s.days_since_last,
        expectedGapDays: s.expected_gap_days,
        severityRatio: s.severity_ratio,
        lastRelayedMessage: ctx?.lastRelayedMessage ?? null,
        hasActiveSuppression: ctx?.hasActiveSuppression ?? false,
        unansweredCount60d: ctx?.unansweredCount60d ?? 0,
        lastRelayedAnyAt: ctx?.lastRelayedAnyAt ?? null,
        now,
      },
      config,
    );

    if (resolution.kind === "no_trigger") continue;

    if (resolution.kind === "suppressed") {
      suppressedCount++;
      if (resolution.autoInsertTwoUnanswered) {
        twoUnansweredInserts.push({
          customer_id: s.customer_id,
          reason: "two_unanswered",
          expires_at: new Date(now.getTime() + config.unansweredCooldownDays * MS_PER_DAY).toISOString(),
        });
      }
      continue;
    }

    contexts.push({
      candidate: resolution.candidate,
      displayName: customer?.display_name ?? "",
      zone: customer?.zone ?? "",
      orderCount: s.order_count,
      favouriteProducts: s.favourite_products ?? [],
      lastOrderProducts: s.last_order_products ?? [],
    });
  }

  if (twoUnansweredInserts.length > 0) {
    // Never resets an existing row's expiry -- if one's already there
    // (e.g. from a prior run), leave it as-is.
    const { error } = await supabase
      .from("eng_suppression")
      .upsert(twoUnansweredInserts, { onConflict: "customer_id,reason", ignoreDuplicates: true });
    if (error) throw new Error(`Failed to auto-insert two_unanswered suppression: ${error.message}`);
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
    suppressed: suppressedCount,
    draftsGenerated: drafts.size,
    draftFailures: messagesAttempted - drafts.size,
  };
}
