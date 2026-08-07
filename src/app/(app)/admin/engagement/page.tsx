import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { buildEngagementConfig } from "@/lib/engagement/config";
import { computePriorityScore, isVipCheckin, type TriggerType } from "@/lib/engagement/priority";
import type { EngagementState } from "@/lib/engagement/classify";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { loadOutcomeStats } from "@/lib/engagement/outcome-stats";
import { EngagementList, type EngagementRow } from "./engagement-list";
import { NudgeQueue, type NudgeQueueRow } from "./nudge-queue";
import { SeasonalNoteEditor } from "./seasonal-note-editor";
import { OutcomeStats } from "./outcome-stats";

// CLAUDE_engagement_engine_FINAL.md §13: slice 1's read-only priority browse
// view (over eng_customer_state) plus slice 4's actionable daily queue
// (over eng_nudge_queue, scoped to breaking/third_order_risk, now with
// drafted messages per §9).
export default async function AdminEngagementPage() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const todayIso = utcToIstDatetimeLocal(new Date()).slice(0, 10);

  const [{ data: states }, { data: customers }, { data: configRows }, { data: queueRows }, { data: settingsRow }, outcomeStats] =
    await Promise.all([
      supabase.from("eng_customer_state").select("*"),
      supabase.from("customers").select("id, display_name, phone, zone"),
      supabase.from("eng_config").select("key, value"),
      supabase
        .from("eng_nudge_queue")
        .select(
          "id, customer_id, trigger_type, recommended_action, priority_score, rationale, draft_message, draft_rationale, status, snooze_until",
        )
        .or(`status.eq.pending,and(status.eq.snoozed,snooze_until.lte.${todayIso})`)
        .order("priority_score", { ascending: false }),
      supabase.from("eng_settings").select("seasonal_note").eq("id", 1).maybeSingle(),
      loadOutcomeStats(supabase),
    ]);

  const config = configRows && configRows.length > 0 ? buildEngagementConfig(configRows) : null;
  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));

  const rows: EngagementRow[] = (states ?? [])
    .map((s) => {
      const customer = customerById.get(s.customer_id);
      if (!customer) return null;

      const state = s.state as EngagementState;
      const isVip = s.is_vip ?? false;
      const revenuePercentile = s.revenue_percentile ?? 0;
      const vipCheckin =
        config !== null && isVipCheckin({ state, isVip, daysSinceLast: s.days_since_last }, config);
      const trigger: TriggerType = vipCheckin ? "vip_checkin" : state;
      const priorityScore = computePriorityScore(trigger, isVip, revenuePercentile);

      const row: EngagementRow = {
        customerId: s.customer_id,
        displayName: customer.display_name,
        phone: customer.phone,
        zone: customer.zone,
        state,
        vipCheckin,
        isVip,
        orderCount: s.order_count,
        daysSinceLast: s.days_since_last,
        expectedGapDays: s.expected_gap_days,
        severityRatio: s.severity_ratio,
        revenue: s.revenue ?? 0,
        favouriteProducts: s.favourite_products ?? [],
        priorityScore,
        computedAt: s.computed_at,
      };
      return row;
    })
    .filter((r): r is EngagementRow => r !== null)
    .sort((a, b) => b.priorityScore - a.priorityScore || a.displayName.localeCompare(b.displayName));

  const computedAt = rows[0]?.computedAt ?? null;

  const nudgeRows: NudgeQueueRow[] = (queueRows ?? [])
    .map((q) => {
      const customer = customerById.get(q.customer_id);
      if (!customer) return null;
      const row: NudgeQueueRow = {
        nudgeId: q.id,
        customerId: q.customer_id,
        displayName: customer.display_name,
        phone: customer.phone,
        zone: customer.zone,
        triggerType: q.trigger_type as EngagementState,
        recommendedAction: q.recommended_action,
        priorityScore: q.priority_score,
        rationale: q.rationale,
        draftMessage: q.draft_message,
        draftRationale: q.draft_rationale,
      };
      return row;
    })
    .filter((r): r is NudgeQueueRow => r !== null);

  return (
    <div className="flex flex-col gap-6 px-[18px] pt-5 pb-6">
      <PageHeader title="Engagement" subtitle="Who to reach out to, and why" />
      <SeasonalNoteEditor initialNote={settingsRow?.seasonal_note ?? null} />
      <NudgeQueue rows={nudgeRows} />
      <div className="flex flex-col gap-3">
        <p className="font-sans text-[13px] font-bold text-muted">All customers by priority</p>
        <EngagementList rows={rows} computedAt={computedAt} hasConfig={config !== null} />
      </div>
      <OutcomeStats rows={outcomeStats} />
    </div>
  );
}
