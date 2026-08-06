// CLAUDE_engagement_engine_FINAL.md §5 STEP 3 + STEP 5, scoped per §13
// slice 3 to two triggers (breaking, third_order_risk). Reads
// eng_customer_state (already fresh from this run's STEP 1) and inserts
// pending eng_nudge_queue rows. Idempotent within a day: re-running the
// pipeline (or the admin's manual recompute) on the same IST calendar date
// won't create a second row for a customer already queued today.
//
// Cross-day accumulation (a still-breaking customer getting a fresh row
// every day they're never actioned) is expected at this slice -- §0.1
// explicitly re-surfaces a still-triggering customer every day regardless
// of nudge history, and the frequency-cap suppression that dampens this is
// slice 5 (§6) work, not yet built.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, NudgeRecommendedAction } from "@/lib/supabase/database.types";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { ACTIVE_TRIGGERS, generateCandidate } from "./candidates";
import type { EngagementState } from "./classify";

type Client = SupabaseClient<Database>;

export interface QueueGenerationSummary {
  candidatesGenerated: number;
  skippedAlreadyQueuedToday: number;
}

export async function runQueueGeneration(supabase: Client): Promise<QueueGenerationSummary> {
  const runDate = utcToIstDatetimeLocal(new Date()).slice(0, 10);

  const { data: states, error: statesError } = await supabase
    .from("eng_customer_state")
    .select("customer_id, state, is_vip, revenue_percentile, order_count, days_since_last, expected_gap_days, severity_ratio")
    .in("state", ACTIVE_TRIGGERS as string[]);
  if (statesError) throw new Error(`Failed to load eng_customer_state: ${statesError.message}`);
  if (!states || states.length === 0) return { candidatesGenerated: 0, skippedAlreadyQueuedToday: 0 };

  const customerIds = states.map((s) => s.customer_id);
  const { data: customers, error: customersError } = await supabase.from("customers").select("id, phone").in("id", customerIds);
  if (customersError) throw new Error(`Failed to load customers: ${customersError.message}`);
  const phoneByCustomer = new Map((customers ?? []).map((c) => [c.id, c.phone]));

  const { data: existingToday, error: existingError } = await supabase
    .from("eng_nudge_queue")
    .select("customer_id")
    .eq("run_date", runDate);
  if (existingError) throw new Error(`Failed to load today's eng_nudge_queue rows: ${existingError.message}`);
  const alreadyQueuedToday = new Set((existingToday ?? []).map((r) => r.customer_id));

  interface QueueRow {
    run_date: string;
    customer_id: string;
    trigger_type: string;
    recommended_action: NudgeRecommendedAction;
    priority_score: number;
    rationale: string;
    status: "pending";
  }
  const rows: QueueRow[] = [];
  let skipped = 0;

  for (const s of states) {
    if (alreadyQueuedToday.has(s.customer_id)) {
      skipped++;
      continue;
    }
    const candidate = generateCandidate({
      customerId: s.customer_id,
      state: s.state as EngagementState,
      phone: phoneByCustomer.get(s.customer_id) ?? null,
      isVip: s.is_vip ?? false,
      revenuePercentile: s.revenue_percentile ?? 0,
      orderCount: s.order_count,
      daysSinceLast: s.days_since_last,
      expectedGapDays: s.expected_gap_days,
      severityRatio: s.severity_ratio,
    });
    if (!candidate) continue;

    rows.push({
      run_date: runDate,
      customer_id: candidate.customerId,
      trigger_type: candidate.triggerType,
      recommended_action: candidate.recommendedAction,
      priority_score: candidate.priorityScore,
      rationale: candidate.rationale,
      status: "pending",
    });
  }

  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from("eng_nudge_queue").insert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(`Failed to insert eng_nudge_queue chunk ${i}: ${error.message}`);
  }

  return { candidatesGenerated: rows.length, skippedAlreadyQueuedToday: skipped };
}
