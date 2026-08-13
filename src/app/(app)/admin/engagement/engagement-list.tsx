"use client";

import { useMemo, useState } from "react";
import { Phone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buildRationale } from "@/lib/engagement/rationale";
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
  return buildRationale({
    state: row.state,
    vipCheckin: row.vipCheckin,
    orderCount: row.orderCount,
    daysSinceLast: row.daysSinceLast,
    expectedGapDays: row.expectedGapDays,
    severityRatio: row.severityRatio,
  });
}

// A row has a real trigger (would generate a nudge candidate once the queue
// exists, §4/§8) whenever its priority score is above the flat revenue-only
// floor every state gets -- i.e. state !== habituated/first_timer/prospect,
// or it's a vip_checkin. Simplest correct test: priorityScore only exceeds
// revenuePercentile*20 when a real base score was added.
function hasTrigger(row: EngagementRow): boolean {
  return row.vipCheckin || !["habituated", "first_timer", "prospect"].includes(row.state);
}

export function EngagementList({ rows }: { rows: EngagementRow[] }) {
  const [showAll, setShowAll] = useState(false);

  const surfaced = useMemo(() => rows.filter(hasTrigger), [rows]);

  const visible = showAll ? rows : surfaced;

  return (
    <div className="flex flex-col gap-4">
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
