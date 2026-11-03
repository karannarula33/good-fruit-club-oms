import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadLearnerModules } from "@/lib/training/load";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { TrainingStatusBadge } from "./status-badge";

// Learn GFC: the learner's list of modules, in order, with progress.
export default async function LearnPage() {
  const profile = await requireRole(["admin", "packer", "delivery", "engagement"]);
  const client = createServiceRoleClient();
  const { data: assigned } = await client.from("training_assignments").select("user_id").eq("user_id", profile.id).maybeSingle();
  const isAdmin = profile.role === "admin";

  if (!assigned && !isAdmin) {
    return (
      <div className="flex flex-col gap-4 px-[18px] pt-5">
        <PageHeader title="Learn GFC" subtitle="How Good Fruit Club works" />
        <Card>
          <p className="font-sans text-sm text-muted">Learn GFC hasn&apos;t been assigned to you yet. Ask Karan.</p>
        </Card>
      </div>
    );
  }

  const { byUser } = await loadLearnerModules([profile.id], client);
  const list = byUser.get(profile.id) ?? [];
  const done = list.filter((m) => m.status === "completed").length;
  const nextUp = list.find((m) => m.status !== "completed");

  return (
    <div className="flex flex-col gap-4 px-[18px] pt-5 pb-6">
      <PageHeader
        title="Learn GFC"
        subtitle={isAdmin && !assigned ? "Preview — your progress isn't tracked as a learner" : "How Good Fruit Club works, step by step"}
      />

      <Card elevated className="space-y-2.5 p-4">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-lg font-bold text-foreground">
            {done} of {list.length} done
          </span>
          {nextUp && (
            <Link href={`/learn/${nextUp.module.slug}`} prefetch={false} className="font-sans text-sm font-extrabold text-brand">
              {nextUp.status === "not_started" ? "Start" : "Continue"} →
            </Link>
          )}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-neutral-bg">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${list.length ? (done / list.length) * 100 : 0}%` }} />
        </div>
        {done === list.length && list.length > 0 && (
          <p className="font-sans text-sm font-semibold text-success-text">All done — well done! Come back any time to look things up.</p>
        )}
      </Card>

      <div className="flex flex-col gap-2.5">
        {list.map((m, i) => (
          <Link key={m.module.id} href={`/learn/${m.module.slug}`} prefetch={false}>
            <Card className="flex items-center gap-3 p-3.5 hover:bg-[#FCFBF7]">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-bg font-sans text-sm font-extrabold text-neutral-text">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-sans text-[14.5px] font-bold text-foreground">{m.module.title}</div>
                <div className="truncate font-sans text-xs text-muted">{m.module.summary}</div>
              </div>
              <TrainingStatusBadge status={m.status} />
              <ChevronRight className="size-4 shrink-0 text-tertiary" aria-hidden="true" />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
