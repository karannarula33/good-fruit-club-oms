import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PageHeader } from "@/components/ui/page-header";
import { ModuleEditor } from "./module-editor";

export default async function EditTrainingModulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRole(["admin"]);
  const client = createServiceRoleClient();
  const [{ data: m }, { data: questions }] = await Promise.all([
    client.from("training_modules").select("id, title, summary, content_md, version").eq("id", id).maybeSingle(),
    client.from("training_questions").select("id, kind, scenario, prompt, options, correct_index, explanation").eq("module_id", id).eq("is_active", true).order("order_index"),
  ]);
  if (!m) notFound();

  return (
    <div className="flex flex-col gap-4 px-[18px] pt-5 pb-8">
      <PageHeader title={`Edit: ${m.title}`} subtitle={`Version ${m.version} · saving a lesson change makes it v${m.version + 1} and asks finished learners to review it`} backHref="/admin/training" backLabel="Training" />
      <ModuleEditor
        moduleId={m.id}
        initial={{ title: m.title, summary: m.summary, contentMd: m.content_md }}
        questions={(questions ?? []).map((q) => ({
          id: q.id,
          kind: q.kind,
          scenario: q.scenario,
          prompt: q.prompt,
          options: q.options as string[],
          correctIndex: q.correct_index,
          explanation: q.explanation,
        }))}
      />
    </div>
  );
}
