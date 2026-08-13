"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatIstDisplay } from "@/lib/time/ist";
import { recomputeEngagementState } from "@/app/actions/engagement";
import type { EngagementState } from "@/lib/engagement/classify";

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

// Top-of-page control for the whole page's data, not just the priority
// list below it -- recomputeEngagementState runs the full pipeline (state
// + outcome evaluation + nudge queue generation), so this is genuinely
// "refresh everything on this page including the queue," not just a
// restat of eng_customer_state.
export function RecomputePanel({
  computedAt,
  hasConfig,
  stateCounts,
}: {
  computedAt: string | null;
  hasConfig: boolean;
  stateCounts: Record<string, number>;
}) {
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();

  function handleRecompute() {
    startTransition(async () => {
      const result = await recomputeEngagementState();
      if (result.ok) {
        const { state, outcomes, queue } = result.summary;
        const outcomeNote = outcomes.evaluated > 0 ? `, ${outcomes.evaluated} outcomes evaluated` : "";
        showToast(`Recomputed ${state.customersProcessed} customers${outcomeNote}, ${queue.candidatesGenerated} new nudges`);
      } else {
        showToast(result.error);
      }
    });
  }

  return (
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
          Refresh nudges
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(["lapsed", "breaking", "third_order_risk", "second_order_risk", "vip_checkin", "drifting"] as const).map(
          (key) => {
            const count = stateCounts[key] ?? 0;
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
  );
}
