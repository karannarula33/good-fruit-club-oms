import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadLearnerModules } from "@/lib/training/load";
import { splitScreens } from "@/lib/training/markdown";
import { ModulePlayer } from "./module-player";

export default async function LearnModulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const profile = await requireRole(["admin", "packer", "delivery", "engagement"]);
  const client = createServiceRoleClient();
  const { data: assigned } = await client.from("training_assignments").select("user_id").eq("user_id", profile.id).maybeSingle();
  if (!assigned && profile.role !== "admin") notFound();

  const { modules, byUser } = await loadLearnerModules([profile.id], client);
  const index = modules.findIndex((m) => m.slug === slug);
  if (index === -1) notFound();
  const lm = byUser.get(profile.id)![index];
  const next = modules[index + 1] ?? null;

  return (
    <ModulePlayer
      key={`${lm.module.id}-${lm.module.version}`}
      moduleId={lm.module.id}
      number={index + 1}
      total={modules.length}
      title={lm.module.title}
      screens={splitScreens(lm.module.content_md)}
      status={lm.status}
      parts={lm.parts}
      viewedScreens={lm.viewedScreens}
      triedScreens={lm.triedScreens}
      bestScore={lm.bestScore}
      questionCount={lm.questionCount}
      nextSlug={next?.slug ?? null}
      nextTitle={next?.title ?? null}
    />
  );
}
