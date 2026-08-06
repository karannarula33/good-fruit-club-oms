import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { buildEngagementConfig } from "@/lib/engagement/config";
import { computePriorityScore, isVipCheckin, type TriggerType } from "@/lib/engagement/priority";
import type { EngagementState } from "@/lib/engagement/classify";
import { PageHeader } from "@/components/ui/page-header";
import { EngagementList, type EngagementRow } from "./engagement-list";

// CLAUDE_engagement_engine_FINAL.md §13 slice 1: a read-only admin view,
// sorted by priority, over eng_customer_state (populated by STEP 1's
// nightly/manual recompute). No queue, no drafting yet -- this alone
// replaces every manual severity-sort the admin used to do by hand.
export default async function AdminEngagementPage() {
  await requireRole(["admin"]);

  const supabase = await createClient();

  const [{ data: states }, { data: customers }, { data: configRows }] = await Promise.all([
    supabase.from("eng_customer_state").select("*"),
    supabase.from("customers").select("id, display_name, phone, zone"),
    supabase.from("eng_config").select("key, value"),
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

  return (
    <div className="flex flex-col gap-5 px-[18px] pt-5 pb-6">
      <PageHeader title="Engagement" subtitle="Who to reach out to, and why" />
      <EngagementList rows={rows} computedAt={computedAt} hasConfig={config !== null} />
    </div>
  );
}
