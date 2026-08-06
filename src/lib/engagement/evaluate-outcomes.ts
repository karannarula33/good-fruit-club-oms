// CLAUDE_engagement_engine_FINAL.md §5 STEP 2: evaluate past outcomes by
// re-reading orders. Runs unconditionally every night (like STEP 1), but is
// a no-op until eng_nudge_queue actually has 'relayed' rows -- slice 3
// builds the queue. Built now (slice 2) so outcome data starts accruing
// from the moment relaying begins, per §13.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { evaluateNudgeOutcome } from "./outcomes";

type Client = SupabaseClient<Database>;

export interface OutcomeEvaluationSummary {
  evaluated: number;
  reorderedWithin7d: number;
  reorderedWithin14d: number;
}

const MS_PER_DAY = 86_400_000;
const FETCH_CHUNK = 200;

export async function runOutcomeEvaluation(supabase: Client): Promise<OutcomeEvaluationSummary> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * MS_PER_DAY).toISOString();

  // §5: "status='relayed', no outcome row, relayed 7+ days ago."
  const { data: relayedRows, error: relayedError } = await supabase
    .from("eng_nudge_queue")
    .select("id, customer_id, relayed_at")
    .eq("status", "relayed")
    .not("relayed_at", "is", null)
    .lte("relayed_at", sevenDaysAgo);
  if (relayedError) throw new Error(`Failed to load relayed eng_nudge_queue rows: ${relayedError.message}`);

  if (!relayedRows || relayedRows.length === 0) {
    return { evaluated: 0, reorderedWithin7d: 0, reorderedWithin14d: 0 };
  }

  const { data: existingOutcomes, error: outcomesError } = await supabase
    .from("eng_nudge_outcomes")
    .select("nudge_id")
    .in(
      "nudge_id",
      relayedRows.map((r) => r.id),
    );
  if (outcomesError) throw new Error(`Failed to load eng_nudge_outcomes: ${outcomesError.message}`);
  const alreadyEvaluated = new Set((existingOutcomes ?? []).map((o) => o.nudge_id));

  const pending = relayedRows.filter((r) => !alreadyEvaluated.has(r.id));
  if (pending.length === 0) {
    return { evaluated: 0, reorderedWithin7d: 0, reorderedWithin14d: 0 };
  }

  const customerIds = [...new Set(pending.map((r) => r.customer_id))];
  const ordersByCustomer = new Map<string, { id: string; placedAt: Date }[]>();
  for (let i = 0; i < customerIds.length; i += FETCH_CHUNK) {
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id, customer_id, placed_at")
      .neq("status", "cancelled")
      .in("customer_id", customerIds.slice(i, i + FETCH_CHUNK));
    if (ordersError) throw new Error(`Failed to load orders chunk ${i}: ${ordersError.message}`);
    for (const order of orders ?? []) {
      const bucket = ordersByCustomer.get(order.customer_id) ?? [];
      bucket.push({ id: order.id, placedAt: new Date(order.placed_at) });
      ordersByCustomer.set(order.customer_id, bucket);
    }
  }

  const outcomeRows = pending.map((row) => {
    const result = evaluateNudgeOutcome(new Date(row.relayed_at as string), ordersByCustomer.get(row.customer_id) ?? []);
    return {
      nudge_id: row.id,
      relayed_at: row.relayed_at,
      reordered_within_7d: result.reorderedWithin7d,
      reordered_within_14d: result.reorderedWithin14d,
      reorder_order_id: result.reorderOrderId,
      days_to_reorder: result.daysToReorder,
      evaluated_at: now.toISOString(),
    };
  });

  const WRITE_CHUNK = 200;
  for (let i = 0; i < outcomeRows.length; i += WRITE_CHUNK) {
    const { error } = await supabase.from("eng_nudge_outcomes").insert(outcomeRows.slice(i, i + WRITE_CHUNK));
    if (error) throw new Error(`Failed to insert eng_nudge_outcomes chunk ${i}: ${error.message}`);
  }

  return {
    evaluated: outcomeRows.length,
    reorderedWithin7d: outcomeRows.filter((r) => r.reordered_within_7d).length,
    reorderedWithin14d: outcomeRows.filter((r) => r.reordered_within_14d).length,
  };
}
