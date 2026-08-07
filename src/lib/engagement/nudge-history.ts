// CLAUDE_engagement_engine_FINAL.md §6/§7: the one DB round-trip that
// feeds both suppression (§6) and action modulation (§7) with a customer's
// recent nudge history. "No reorder" is read from eng_nudge_outcomes
// (STEP 2's own "did nudges work" ledger, see modulate.ts's header
// comment for why that's safe on timing), not re-derived from orders.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { LastRelayedMessage } from "./modulate";

type Client = SupabaseClient<Database>;

export interface NudgeHistoryContext {
  lastRelayedAnyAt: Date | null;
  lastRelayedMessage: LastRelayedMessage | null;
  unansweredCount60d: number;
  hasActiveSuppression: boolean;
}

const EMPTY_CONTEXT: NudgeHistoryContext = {
  lastRelayedAnyAt: null,
  lastRelayedMessage: null,
  unansweredCount60d: 0,
  hasActiveSuppression: false,
};

const MS_PER_DAY = 86_400_000;
const HISTORY_WINDOW_DAYS = 60; // covers the frequency cap (10d), follow-up (14d), lapsed escalation (21d), and the two_unanswered count (60d) in one fetch

export async function loadNudgeHistory(
  supabase: Client,
  customerIds: string[],
  now: Date,
): Promise<Map<string, NudgeHistoryContext>> {
  const result = new Map<string, NudgeHistoryContext>();
  if (customerIds.length === 0) return result;

  const windowStart = new Date(now.getTime() - HISTORY_WINDOW_DAYS * MS_PER_DAY).toISOString();

  const { data: relayed, error: relayedError } = await supabase
    .from("eng_nudge_queue")
    .select("id, customer_id, relayed_at, recommended_action")
    .in("customer_id", customerIds)
    .eq("status", "relayed")
    .not("relayed_at", "is", null)
    .gte("relayed_at", windowStart);
  if (relayedError) throw new Error(`Failed to load eng_nudge_queue history: ${relayedError.message}`);

  const relayedRows = relayed ?? [];
  const nudgeIds = relayedRows.map((r) => r.id);

  const { data: outcomes, error: outcomesError } =
    nudgeIds.length > 0
      ? await supabase.from("eng_nudge_outcomes").select("nudge_id, reordered_within_14d").in("nudge_id", nudgeIds)
      : { data: [], error: null };
  if (outcomesError) throw new Error(`Failed to load eng_nudge_outcomes history: ${outcomesError.message}`);
  const reorderedWithin14dByNudgeId = new Map((outcomes ?? []).map((o) => [o.nudge_id, o.reordered_within_14d]));

  const { data: suppressionRows, error: suppressionError } = await supabase
    .from("eng_suppression")
    .select("customer_id, expires_at")
    .in("customer_id", customerIds);
  if (suppressionError) throw new Error(`Failed to load eng_suppression: ${suppressionError.message}`);
  const activeSuppressionCustomerIds = new Set(
    (suppressionRows ?? [])
      .filter((s) => s.expires_at === null || new Date(s.expires_at).getTime() > now.getTime())
      .map((s) => s.customer_id),
  );

  const byCustomer = new Map<string, typeof relayedRows>();
  for (const row of relayedRows) {
    const bucket = byCustomer.get(row.customer_id) ?? [];
    bucket.push(row);
    byCustomer.set(row.customer_id, bucket);
  }

  for (const customerId of customerIds) {
    const rows = byCustomer.get(customerId) ?? [];
    const hasActiveSuppression = activeSuppressionCustomerIds.has(customerId);

    if (rows.length === 0 && !hasActiveSuppression) {
      result.set(customerId, EMPTY_CONTEXT);
      continue;
    }

    let lastRelayedAnyAt: Date | null = null;
    let lastRelayedMessageRow: (typeof rows)[number] | null = null;
    let unansweredCount60d = 0;

    for (const row of rows) {
      const relayedAt = new Date(row.relayed_at as string);
      if (!lastRelayedAnyAt || relayedAt.getTime() > lastRelayedAnyAt.getTime()) {
        lastRelayedAnyAt = relayedAt;
      }
      if (
        row.recommended_action === "message" &&
        (!lastRelayedMessageRow || relayedAt.getTime() > new Date(lastRelayedMessageRow.relayed_at as string).getTime())
      ) {
        lastRelayedMessageRow = row;
      }
      const reorderedWithin14d = reorderedWithin14dByNudgeId.get(row.id);
      if (reorderedWithin14d === false) unansweredCount60d++;
    }

    const lastRelayedMessage: LastRelayedMessage | null = lastRelayedMessageRow
      ? {
          relayedAt: new Date(lastRelayedMessageRow.relayed_at as string),
          reorderedWithin14d: reorderedWithin14dByNudgeId.get(lastRelayedMessageRow.id) ?? null,
        }
      : null;

    result.set(customerId, { lastRelayedAnyAt, lastRelayedMessage, unansweredCount60d, hasActiveSuppression });
  }

  return result;
}
