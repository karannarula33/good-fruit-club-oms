"use client";

import { useState, useTransition } from "react";
import { Phone, Check, X, Clock, Pencil } from "lucide-react";
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
  draftMessage: string | null;
  draftRationale: string | null;
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

// §13 slice 4: draft_message now exists for most `message` candidates (§9).
// Relay sends the draft as-is (finalMessage = draftMessage); Edit swaps the
// draft into an editable textarea so the admin can tweak it before Save &
// Relay sends the edited text as finalMessage. No-draft rows (skip_no_phone,
// or a failed draft call) fall back to slice 3's behaviour exactly: Relay
// with no finalMessage, admin messages in their own words using the
// rationale as the cue.
function NudgeCard({ row, onActioned }: { row: NudgeQueueRow; onActioned: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(row.draftMessage ?? "");
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
            {row.recommendedAction === "call" && (
              <Badge tone="warning" size="sm">
                Call
              </Badge>
            )}
          </div>
          <p className="mt-1 font-display text-[15px] font-bold text-foreground truncate">{row.displayName}</p>
          <p className="font-sans text-[11.5px] font-medium text-muted">{row.zone}</p>
        </div>
        <p className="shrink-0 font-sans text-[10.5px] font-bold text-muted">P{row.priorityScore.toFixed(0)}</p>
      </div>

      <p className="font-sans text-[12.5px] font-medium text-foreground">{row.rationale}</p>

      {row.draftMessage &&
        (isEditing ? (
          <textarea
            rows={4}
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
            className="w-full rounded-2xl border-[1.5px] border-[#ECEAE3] bg-[#F1F1EE] p-3 font-sans text-[13.5px] font-medium leading-[1.55] text-foreground focus:outline-none"
          />
        ) : (
          <div className="rounded-2xl rounded-bl-[4px] bg-[#DCF3D5] p-3">
            <p className="whitespace-pre-wrap font-sans text-[13px] leading-[1.6] text-foreground">{row.draftMessage}</p>
          </div>
        ))}
      {row.draftRationale && !isEditing && (
        <p className="font-sans text-[11px] font-medium text-muted">why: {row.draftRationale}</p>
      )}

      <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
        {row.phone ? (
          <a href={`tel:${row.phone}`} className="inline-flex items-center gap-1 font-sans text-[12.5px] font-bold text-brand">
            <Phone className="size-3.5" aria-hidden="true" />
            {row.phone}
          </a>
        ) : (
          <span className="font-sans text-[11.5px] font-bold text-danger-text">No phone on file</span>
        )}

        {isEditing ? (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="dark"
              disabled={isPending}
              onClick={() => run(() => relayNudge(row.nudgeId, editedText), "Marked relayed")}
            >
              <Check className="size-3.5" aria-hidden="true" />
              Save & Relay
            </Button>
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setIsEditing(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="dark"
              disabled={isPending}
              onClick={() =>
                run(
                  () => relayNudge(row.nudgeId, row.draftMessage ?? undefined),
                  row.recommendedAction === "call" ? "Marked called" : "Marked relayed",
                )
              }
            >
              {row.recommendedAction === "call" ? (
                <Phone className="size-3.5" aria-hidden="true" />
              ) : (
                <Check className="size-3.5" aria-hidden="true" />
              )}
              {row.recommendedAction === "call" ? "Mark called" : "Relay"}
            </Button>
            {row.draftMessage && (
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => {
                  setEditedText(row.draftMessage ?? "");
                  setIsEditing(true);
                }}
              >
                <Pencil className="size-3.5" aria-hidden="true" />
                Edit
              </Button>
            )}
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
        )}
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
