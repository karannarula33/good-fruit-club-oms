import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadLearnerModules } from "@/lib/training/load";
import { splitScreens } from "@/lib/training/markdown";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { TrainingStatusBadge } from "@/app/(app)/learn/status-badge";
import { ResetModuleButton } from "./reset-button";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

// One learner: each module's status, score and dates, a reset per module, and
// a timeline of everything they did (screens viewed, try-its, checks, sign-offs).
export default async function LearnerTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRole(["admin"]);
  const client = createServiceRoleClient();
  const { data: profile } = await client.from("profiles").select("id, full_name, role").eq("id", id).maybeSingle();
  if (!profile) notFound();

  const { modules, byUser } = await loadLearnerModules([id], client);
  const list = byUser.get(id) ?? [];
  const [{ data: events }, { data: attempts }, { data: progress }] = await Promise.all([
    client.from("training_events").select("module_id, module_version, screen_index, event, at").eq("user_id", id).order("at", { ascending: false }).limit(300),
    client.from("training_attempts").select("module_id, module_version, score, passed, attempted_at").eq("user_id", id).order("attempted_at", { ascending: false }).limit(100),
    client.from("training_progress").select("module_id, acknowledged_at, acknowledged_version").eq("user_id", id),
  ]);

  const mod = new Map(modules.map((m, i) => [m.id, { n: i + 1, title: m.title, screens: splitScreens(m.content_md).map((s) => s.title) }]));
  type Item = { at: string; text: string };
  const items: Item[] = [
    ...(events ?? []).map((e) => {
      const m = mod.get(e.module_id);
      const screen = e.screen_index !== null && m ? m.screens[e.screen_index] ?? `screen ${e.screen_index + 1}` : "";
      const what =
        e.event === "viewed" ? `viewed “${screen}”` : e.event === "try_it_done" ? `did the try-it on “${screen}”` : "module reset by admin";
      return { at: e.at, text: `${m ? `${m.n}. ${m.title}` : "Module"} — ${what}` };
    }),
    ...(attempts ?? []).map((a) => {
      const m = mod.get(a.module_id);
      return { at: a.attempted_at, text: `${m ? `${m.n}. ${m.title}` : "Module"} — quick check ${a.score}% ${a.passed ? "(passed)" : "(not passed)"}` };
    }),
    ...(progress ?? [])
      .filter((p) => p.acknowledged_at)
      .map((p) => {
        const m = mod.get(p.module_id);
        return { at: p.acknowledged_at!, text: `${m ? `${m.n}. ${m.title}` : "Module"} — acknowledged “read and understood” (v${p.acknowledged_version})` };
      }),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="flex flex-col gap-4 px-[18px] pt-5 pb-8">
      <PageHeader title={profile.full_name || "Learner"} subtitle={`Learn GFC · ${list.filter((m) => m.status === "completed").length} of ${list.length} done`} backHref="/admin/training" backLabel="Training" />

      <Card elevated className="space-y-1 p-4">
        {list.map((m, i) => (
          <div key={m.module.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[#F3F1EA] py-2 first:border-t-0 font-sans text-[13.5px]">
            <div className="min-w-0">
              <div className="font-semibold">
                {i + 1}. {m.module.title}
              </div>
              <div className="text-[12px] text-muted">
                Screens {m.viewedScreens.filter((s) => s < m.screenCount).length}/{m.screenCount}
                {m.questionCount > 0 && ` · check ${m.bestScore !== null ? `${m.bestScore}%` : "—"} (${m.attempts} tr${m.attempts === 1 ? "y" : "ies"})`}
                {m.completedAt && ` · done ${fmt(m.completedAt)}`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <TrainingStatusBadge status={m.status} />
              {m.status !== "not_started" && <ResetModuleButton userId={id} moduleId={m.module.id} />}
            </div>
          </div>
        ))}
      </Card>

      <Card elevated className="space-y-1 p-4">
        <p className="pb-1 font-sans text-[13px] font-bold text-muted">Timeline</p>
        {items.length === 0 && <p className="font-sans text-sm text-muted">Nothing yet.</p>}
        {items.map((it, i) => (
          <div key={i} className="flex gap-3 border-t border-[#F3F1EA] py-1.5 first:border-t-0 font-sans text-[13px]">
            <span className="w-28 shrink-0 text-[12px] text-tertiary">{fmt(it.at)}</span>
            <span>{it.text}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
