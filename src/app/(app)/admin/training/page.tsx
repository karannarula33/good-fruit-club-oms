import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadLearnerModules } from "@/lib/training/load";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { ModuleStatus } from "@/lib/training/progress";
import { AssignPanel } from "./assign-panel";

const CELL: Record<ModuleStatus, string> = {
  completed: "bg-success-bg text-success-text",
  in_progress: "bg-info-bg text-info-text",
  needs_review: "bg-warning-bg text-warning-text",
  not_started: "bg-neutral-bg text-tertiary",
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";

// Learn GFC admin: who's assigned, a learners x modules grid, weak spots,
// and the modules to edit.
export default async function TrainingAdminPage() {
  await requireRole(["admin"]);
  const client = createServiceRoleClient();

  const [{ data: assignments }, { data: profiles }] = await Promise.all([
    client.from("training_assignments").select("user_id, assigned_at"),
    client.from("profiles").select("id, full_name, role").not("role", "is", null).order("full_name"),
  ]);
  const learnerIds = (assignments ?? []).map((a) => a.user_id);
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, `${p.full_name || "Unnamed"}${p.role ? ` · ${p.role}` : ""}`]));
  const { modules, byUser } = await loadLearnerModules(learnerIds, client);

  // Weak spots: questions most often answered wrong (all attempts).
  const [{ data: attempts }, { data: questions }] = await Promise.all([
    learnerIds.length
      ? client.from("training_attempts").select("answers").in("user_id", learnerIds)
      : Promise.resolve({ data: [] as { answers: { questionId: string; correct: boolean }[] }[] }),
    client.from("training_questions").select("id, module_id, prompt"),
  ]);
  const tally = new Map<string, { wrong: number; seen: number }>();
  for (const a of attempts ?? []) {
    for (const d of (a.answers as { questionId: string; correct: boolean }[]) ?? []) {
      const t = tally.get(d.questionId) ?? { wrong: 0, seen: 0 };
      t.seen++;
      if (!d.correct) t.wrong++;
      tally.set(d.questionId, t);
    }
  }
  const qById = new Map((questions ?? []).map((q) => [q.id, q]));
  const modTitle = new Map(modules.map((m, i) => [m.id, `${i + 1}. ${m.title}`]));
  const weak = [...tally.entries()]
    .filter(([, t]) => t.wrong > 0)
    .sort((a, b) => b[1].wrong - a[1].wrong || b[1].wrong / b[1].seen - a[1].wrong / a[1].seen)
    .slice(0, 6)
    .map(([id, t]) => ({ q: qById.get(id), ...t }))
    .filter((w) => w.q);

  return (
    <div className="flex flex-col gap-5 px-[18px] pt-5 pb-8">
      <PageHeader title="Training" subtitle="Learn GFC onboarding: who's done what" action={<Link href="/learn" prefetch={false} className="font-sans text-sm font-extrabold text-brand">Preview →</Link>} />

      <AssignPanel
        assigned={learnerIds.map((id) => ({ id, name: nameOf.get(id) ?? id }))}
        candidates={(profiles ?? []).filter((p) => !learnerIds.includes(p.id)).map((p) => ({ id: p.id, name: nameOf.get(p.id) ?? p.id }))}
      />

      {learnerIds.length > 0 && (
        <Card elevated className="space-y-3 p-4">
          <p className="font-sans text-[13px] font-bold text-muted">Progress</p>
          <div className="-mx-1 overflow-x-auto">
            <table className="border-collapse font-sans text-[12px]">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-white px-2 py-1 text-left text-muted">Learner</th>
                  {modules.map((m, i) => (
                    <th key={m.id} title={m.title} className="px-1 py-1 text-center font-bold text-muted">
                      {i + 1}
                    </th>
                  ))}
                  <th className="px-2 py-1 text-left text-muted">Done</th>
                </tr>
              </thead>
              <tbody>
                {learnerIds.map((id) => {
                  const list = byUser.get(id) ?? [];
                  const done = list.filter((m) => m.status === "completed").length;
                  const last = list.map((m) => m.lastActivity).filter(Boolean).sort().pop() ?? null;
                  return (
                    <tr key={id}>
                      <td className="sticky left-0 whitespace-nowrap bg-white px-2 py-1.5">
                        <Link href={`/admin/training/learner/${id}`} prefetch={false} className="font-bold text-foreground underline-offset-2 hover:underline">
                          {nameOf.get(id) ?? id}
                        </Link>
                        <div className="text-[10.5px] text-tertiary">Last active {fmt(last)}</div>
                      </td>
                      {list.map((m) => (
                        <td key={m.module.id} className="px-0.5 py-1.5 text-center">
                          <span
                            title={`${m.module.title}: ${m.status}${m.bestScore !== null ? ` · best ${m.bestScore}%` : ""}${m.completedAt ? ` · done ${fmt(m.completedAt)}` : ""}`}
                            className={cn("inline-flex h-7 min-w-8 items-center justify-center rounded-lg px-1 text-[10.5px] font-extrabold", CELL[m.status])}
                          >
                            {m.status === "completed" ? "✓" : m.bestScore !== null ? `${m.bestScore}` : m.status === "needs_review" ? "!" : m.status === "in_progress" ? "…" : ""}
                          </span>
                        </td>
                      ))}
                      <td className="whitespace-nowrap px-2 py-1.5 font-bold">
                        {done}/{list.length}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="font-sans text-[11.5px] text-tertiary">
            ✓ done · number = best quick-check % · … started · ! updated, needs review. Tap a learner for their timeline.
          </p>
        </Card>
      )}

      {weak.length > 0 && (
        <Card elevated className="space-y-2 p-4">
          <p className="font-sans text-[13px] font-bold text-muted">Weak spots — most often answered wrong</p>
          {weak.map((w) => (
            <div key={w.q!.id} className="border-t border-[#F3F1EA] pt-2 font-sans text-[13.5px]">
              <p className="font-semibold text-foreground">{w.q!.prompt}</p>
              <p className="text-[12px] text-muted">
                {modTitle.get(w.q!.module_id)} · wrong {w.wrong} of {w.seen} times
              </p>
            </div>
          ))}
        </Card>
      )}

      <Card elevated className="space-y-1 p-4">
        <p className="pb-1 font-sans text-[13px] font-bold text-muted">Modules</p>
        {modules.map((m, i) => (
          <div key={m.id} className="flex items-center justify-between gap-3 border-t border-[#F3F1EA] py-2 font-sans text-[14px]">
            <span>
              <strong>{i + 1}.</strong> {m.title} <span className="text-[11.5px] text-tertiary">v{m.version}</span>
            </span>
            <Link href={`/admin/training/edit/${m.id}`} prefetch={false} className="shrink-0 text-sm font-extrabold text-brand">
              Edit
            </Link>
          </div>
        ))}
        {modules.length === 0 && <p className="font-sans text-sm text-muted">No modules yet — run scripts/seed_training.ts.</p>}
      </Card>
    </div>
  );
}
