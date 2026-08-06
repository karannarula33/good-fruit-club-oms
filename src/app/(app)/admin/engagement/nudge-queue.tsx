"use client";

import { useState, useTransition } from "react";
import { Phone, Check, X, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { relayNudge, skipNudge, snoozeNudge } from "@/app/actions/engagement";
import type { EngagementState } from "@/lib/engagement/classify";
import type { CustomerZone } from "@/lib/supabase/database.types";

export interface NudgeQueueRow {
  nudgeId: string;
  customerId: string;
  displayName: string;
  phone: string | null;
  zone: CustomerZone;
  triggerType: EngagementState;
  recommendedAction: "message" | "call" | "skip_no_phone";
  priorityScore: number;
  rationale: string;
}

const TRIGGER_LABEL: Record<string, string> = {
  lapsed: "Lapsed",
  breaking: "Breaking",
  drifting: "Drifting",
  third_order_risk: "3rd-order risk",
  second_order_risk: "2nd-order risk",
  vip_checkin: "VIP check-in",
};

const TRIGGER_TONE: Record<string, BadgeTone> = {
  lapsed: "danger",
  breaking: "warning",
  drifting: "warning",
  third_order_risk: "info",
  second_order_risk: "info",
  vip_checkin: "brand",
};

// §13 slice 3: no draft_message exists yet (that's slice 4) -- Relay here
// means "admin messaged them in their own words, using the rationale as the
// cue, then logs it" so STEP 2's outcome tracking (slice 2) has real relays
// to measure. Edit isn't offered since there's nothing drafted to edit.
function NudgeCard({ row, onActioned }: { row: NudgeQueueRow; onActioned: () => void }) {
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, doneMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        showToast(doneMessage);
        onActioned();
      } else {
        showToast(result.error);
      }
    });
  }

  return (
    <Card elevated className="gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge tone={TRIGGER_TONE[row.triggerType] ?? "neutral"} size="sm">
              {TRIGGER_LABEL[row.triggerType] ?? row.triggerType}
            </Badge>
            {row.recommendedAction === "skip_no_phone" && (
              <Badge tone="danger" size="sm">
                No phone
              </Badge>
            )}
          </div>
          <p className="mt-1 font-display text-[15px] font-bold text-foreground truncate">{row.displayName}</p>
          <p className="font-sans text-[11.5px] font-medium text-muted">{row.zone}</p>
        </div>
        <p className="shrink-0 font-sans text-[10.5px] font-bold text-muted">P{row.priorityScore.toFixed(0)}</p>
      </div>

      <p className="font-sans text-[12.5px] font-medium text-foreground">{row.rationale}</p>

      <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
        {row.phone ? (
          <a href={`tel:${row.phone}`} className="inline-flex items-center gap-1 font-sans text-[12.5px] font-bold text-brand">
            <Phone className="size-3.5" aria-hidden="true" />
            {row.phone}
          </a>
        ) : (
          <span className="font-sans text-[11.5px] font-bold text-danger-text">No phone on file</span>
        )}

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="dark"
            disabled={isPending}
            onClick={() => run(() => relayNudge(row.nudgeId), "Marked relayed")}
          >
            <Check className="size-3.5" aria-hidden="true" />
            Relay
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => run(() => snoozeNudge(row.nudgeId), "Snoozed 3d")}
          >
            <Clock className="size-3.5" aria-hidden="true" />
            Snooze
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => run(() => skipNudge(row.nudgeId), "Skipped")}
          >
            <X className="size-3.5" aria-hidden="true" />
            Skip
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function NudgeQueue({ rows }: { rows: NudgeQueueRow[] }) {
  const [actionedIds, setActionedIds] = useState<Set<string>>(new Set());
  const visible = rows.filter((r) => !actionedIds.has(r.nudgeId));

  return (
    <div className="flex flex-col gap-2.5">
      <p className="font-sans text-[13px] font-bold text-foreground">
        {visible.length > 0 ? `${visible.length} in today's queue` : "Queue is clear"}
      </p>

      {visible.length === 0 ? (
        <Card className="items-center py-6 text-center">
          <p className="font-sans text-sm font-medium text-muted">Nothing pending -- run a recompute to generate today&rsquo;s candidates.</p>
        </Card>
      ) : (
        visible.map((row) => (
          <NudgeCard
            key={row.nudgeId}
            row={row}
            onActioned={() => setActionedIds((prev) => new Set(prev).add(row.nudgeId))}
          />
        ))
      )}
    </div>
  );
}
