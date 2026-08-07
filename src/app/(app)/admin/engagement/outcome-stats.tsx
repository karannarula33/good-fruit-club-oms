import { Card } from "@/components/ui/card";
import type { OutcomeStatsRow } from "@/lib/engagement/outcome-stats";

// Groundwork for CLAUDE_engagement_engine_FINAL.md §13 slice 6 -- once
// real relay history exists, this is where the numbers needed to tune §3's
// constants (DRIFT_SEVERITY_*, LAPSED_ABSOLUTE_DAYS, grace-day thresholds)
// show up, instead of a one-off SQL query each time. Read-only, no
// eng_config values are ever written from this view.

const TRIGGER_LABEL: Record<string, string> = {
  lapsed: "Lapsed",
  breaking: "Breaking",
  drifting: "Drifting",
  third_order_risk: "3rd-order risk",
  second_order_risk: "2nd-order risk",
  vip_checkin: "VIP check-in",
};

function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function formatDays(days: number | null): string {
  return days === null ? "—" : `${days.toFixed(1)}d`;
}

export function OutcomeStats({ rows }: { rows: OutcomeStatsRow[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-sans text-[13px] font-bold text-muted">Nudge outcomes</p>

      {rows.length === 0 ? (
        <Card className="items-center py-6 text-center">
          <p className="font-sans text-sm font-medium text-muted">
            No relayed nudges yet — stats will show up here once nudges start getting relayed.
          </p>
        </Card>
      ) : (
        <Card className="gap-3">
          {rows.map((row) => (
            <div key={row.triggerType} className="flex flex-col gap-1 border-b border-[#ECEAE3] pb-3 last:border-0 last:pb-0">
              <p className="font-sans text-[13px] font-bold text-foreground">
                {TRIGGER_LABEL[row.triggerType] ?? row.triggerType}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-sans text-[11.5px] font-medium text-muted">
                <span>{row.relayedCount} relayed</span>
                <span>
                  {row.evaluatedCount} evaluated{row.pendingCount > 0 ? ` (${row.pendingCount} pending)` : ""}
                </span>
                <span>{formatRate(row.reorderedWithin7dRate)} reordered ≤7d</span>
                <span>{formatRate(row.reorderedWithin14dRate)} reordered ≤14d</span>
                <span>avg {formatDays(row.avgDaysToReorder)} to reorder</span>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
