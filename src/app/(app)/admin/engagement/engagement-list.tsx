"use client";

import { useMemo, useState, useTransition } from "react";
import { RefreshCw, Phone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatIstDisplay } from "@/lib/time/ist";
import { recomputeEngagementState } from "@/app/actions/engagement";
import type { EngagementState } from "@/lib/engagement/classify";
import type { CustomerZone } from "@/lib/supabase/database.types";

export interface EngagementRow {
  customerId: string;
  displayName: string;
  phone: string | null;
  zone: CustomerZone;
  state: EngagementState;
  vipCheckin: boolean;
  isVip: boolean;
  orderCount: number;
  daysSinceLast: number | null;
  expectedGapDays: number | null;
  severityRatio: number | null;
  revenue: number;
  favouriteProducts: string[];
  priorityScore: number;
  computedAt: string;
}

const STATE_LABEL: Record<EngagementState, string> = {
  lapsed: "Lapsed",
  breaking: "Breaking",
  drifting: "Drifting",
  third_order_risk: "3rd-order risk",
  second_order_risk: "2nd-order risk",
  first_timer: "First timer",
  habituated: "Habituated",
  prospect: "Prospect",
};

const STATE_TONE: Record<EngagementState, BadgeTone> = {
  lapsed: "danger",
  breaking: "warning",
  drifting: "warning",
  third_order_risk: "info",
  second_order_risk: "info",
  first_timer: "neutral",
  habituated: "success",
  prospect: "neutral",
};

function rationale(row: EngagementRow): string {
  if (row.vipCheckin) {
    return `VIP, on rhythm, silent ${row.daysSinceLast}d.`;
  }
  if (row.state === "prospect") return "No orders yet.";
  if (row.state === "first_timer") return `1 order, ${row.daysSinceLast}d ago -- still within grace.`;
  if (row.severityRatio === null || row.expectedGapDays === null) {
    return `${row.orderCount} orders, ${row.daysSinceLast}d silent.`;
  }
  const gap = row.expectedGapDays < 10 ? row.expectedGapDays.toFixed(1) : Math.round(row.expectedGapDays);
  return `Orders every ~${gap}d, silent ${row.daysSinceLast}d (${row.severityRatio.toFixed(1)}x).`;
}

// A row has a real trigger (would generate a nudge candidate once the queue
// exists, §4/§8) whenever its priority score is above the flat revenue-only
// floor every state gets -- i.e. state !== habituated/first_timer/prospect,
// or it's a vip_checkin. Simplest correct test: priorityScore only exceeds
// revenuePercentile*20 when a real base score was added.
function hasTrigger(row: EngagementRow): boolean {
  return row.vipCheckin || !["habituated", "first_timer", "prospect"].includes(row.state);
}

export function EngagementList({ rows, computedAt, hasConfig }: { rows: EngagementRow[]; computedAt: string | null; hasConfig: boolean }) {
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();
  const [showAll, setShowAll] = useState(false);

  const { surfaced, stateCounts } = useMemo(() => {
    const surfaced = rows.filter(hasTrigger);
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.vipCheckin ? "vip_checkin" : row.state, (counts.get(row.vipCheckin ? "vip_checkin" : row.state) ?? 0) + 1);
    return { surfaced, stateCounts: counts };
  }, [rows]);

  const visible = showAll ? rows : surfaced;

  function handleRecompute() {
    startTransition(async () => {
      const result = await recomputeEngagementState();
      if (result.ok) {
        const { state, outcomes } = result.summary;
        const outcomeNote = outcomes.evaluated > 0 ? `, ${outcomes.evaluated} outcomes evaluated` : "";
        showToast(`Recomputed ${state.customersProcessed} customers${outcomeNote}`);
      } else {
        showToast(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-sans text-xs font-bold text-muted">
              {computedAt ? `Last computed ${formatIstDisplay(new Date(computedAt))}` : "Never computed yet"}
            </p>
            {!hasConfig && (
              <p className="mt-1 font-sans text-xs font-bold text-danger-text">
                eng_config is empty -- recompute will fail until it&rsquo;s seeded.
              </p>
            )}
          </div>
          <Button size="sm" variant="dark" pending={isPending} pendingText="Recomputing..." onClick={handleRecompute}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Recompute now
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["lapsed", "breaking", "third_order_risk", "second_order_risk", "vip_checkin", "drifting"] as const).map(
            (key) => {
              const count = stateCounts.get(key) ?? 0;
              if (count === 0) return null;
              const label = key === "vip_checkin" ? "VIP check-in" : STATE_LABEL[key as EngagementState];
              const tone = key === "vip_checkin" ? "brand" : STATE_TONE[key as EngagementState];
              return (
                <Badge key={key} tone={tone} size="sm">
                  {count} {label}
                </Badge>
              );
            },
          )}
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <p className="font-sans text-[13px] font-bold text-foreground">
          {showAll ? `All ${rows.length} customers` : `${surfaced.length} need attention`}
        </p>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="font-sans text-[12.5px] font-bold text-brand"
        >
          {showAll ? "Show only flagged" : "Show everyone"}
        </button>
      </div>

      {visible.length === 0 && (
        <Card className="items-center py-8 text-center">
          <p className="font-sans text-sm font-medium text-muted">
            {rows.length === 0 ? "No state computed yet -- run a recompute above." : "Nobody needs outreach right now."}
          </p>
        </Card>
      )}

      <div className="flex flex-col gap-2.5">
        {visible.map((row) => (
          <Card key={row.customerId} elevated className="gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge tone={row.vipCheckin ? "brand" : STATE_TONE[row.state]} size="sm">
                    {row.vipCheckin ? "VIP check-in" : STATE_LABEL[row.state]}
                  </Badge>
                  {row.isVip && !row.vipCheckin && (
                    <Badge tone="brand" size="sm">
                      VIP
                    </Badge>
                  )}
                </div>
                <p className="mt-1 font-display text-[15px] font-bold text-foreground truncate">{row.displayName}</p>
                <p className="font-sans text-[11.5px] font-medium text-muted">{row.zone}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-sans text-sm font-extrabold text-foreground">₹{row.revenue.toLocaleString("en-IN")}</p>
                <p className="font-sans text-[10.5px] font-bold text-muted">lifetime</p>
              </div>
            </div>

            <p className="font-sans text-[12.5px] font-medium text-foreground">{rationale(row)}</p>

            {row.favouriteProducts.length > 0 && (
              <p className="font-sans text-[11.5px] font-medium text-muted">
                Favourites: {row.favouriteProducts.join(", ")}
              </p>
            )}

            <div className="flex items-center justify-between pt-1">
              <p className="font-sans text-[10.5px] font-bold text-muted">Priority {row.priorityScore.toFixed(0)}</p>
              {row.phone ? (
                <a
                  href={`tel:${row.phone}`}
                  className="inline-flex items-center gap-1 font-sans text-[12.5px] font-bold text-brand"
                >
                  <Phone className="size-3.5" aria-hidden="true" />
                  {row.phone}
                </a>
              ) : (
                <span className="font-sans text-[11.5px] font-bold text-danger-text">No phone on file</span>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
