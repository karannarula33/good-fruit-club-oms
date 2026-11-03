// Server-side reads for Learn GFC. Uses the service role (learners can't read
// the questions table, and every status is worked out here from the raw
// events, attempts and acknowledgements -- never trusted from the browser).
// Only import from server actions / server components.
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { moduleParts, moduleStatus, type ModuleParts, type ModuleStatus } from "./progress";
import { screenCount } from "./markdown";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { Database } from "@/lib/supabase/database.types";

type Client = ReturnType<typeof createServiceRoleClient>;

export interface ModuleRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  order_index: number;
  content_md: string;
  version: number;
  is_active: boolean;
  updated_at: string;
}

export interface LearnerModule {
  module: ModuleRow;
  screenCount: number;
  questionCount: number;
  status: ModuleStatus;
  parts: ModuleParts;
  viewedScreens: number[];
  triedScreens: number[];
  bestScore: number | null;       // best quick-check % for the current version
  attempts: number;               // attempts for the current version
  lastActivity: string | null;
  completedAt: string | null;
}

export async function loadModules(client: Client = createServiceRoleClient(), includeInactive = false): Promise<ModuleRow[]> {
  let q = client.from("training_modules").select("id, slug, title, summary, order_index, content_md, version, is_active, updated_at").order("order_index");
  if (!includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ModuleRow[];
}

export async function questionCounts(client: Client): Promise<Map<string, number>> {
  const { data, error } = await client.from("training_questions").select("module_id").eq("is_active", true);
  if (error) throw new Error(error.message);
  const m = new Map<string, number>();
  for (const r of data ?? []) m.set(r.module_id, (m.get(r.module_id) ?? 0) + 1);
  return m;
}

// Everything a set of learners did, worked into per-module status. A module
// reset (event 'reset') wipes what came before it for that module.
export async function loadLearnerModules(userIds: string[], client: Client = createServiceRoleClient()) {
  const [modules, counts] = await Promise.all([loadModules(client), questionCounts(client)]);
  const ids = userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"];
  // Paged: PostgREST silently caps a select at 1000 rows.
  const [events, attempts, progress] = await Promise.all([
    fetchAllRows((from, to) =>
      client.from("training_events").select("user_id, module_id, module_version, screen_index, event, at").in("user_id", ids).order("at").order("id").range(from, to),
    ),
    fetchAllRows((from, to) =>
      client.from("training_attempts").select("user_id, module_id, module_version, score, passed, attempted_at").in("user_id", ids).order("attempted_at").order("id").range(from, to),
    ),
    fetchAllRows((from, to) => client.from("training_progress").select("*").in("user_id", ids).range(from, to)),
  ]);

  const result = new Map<string, LearnerModule[]>();
  for (const userId of userIds) {
    const list: LearnerModule[] = modules.map((module) => {
      const mine = (r: { user_id: string; module_id: string }) => r.user_id === userId && r.module_id === module.id;
      const evs = (events ?? []).filter(mine);
      const resetAt = evs.filter((e) => e.event === "reset").map((e) => e.at).pop() ?? null;
      const after = (at: string) => !resetAt || at > resetAt;
      const live = evs.filter((e) => e.event !== "reset" && after(e.at));
      const current = live.filter((e) => e.module_version === module.version);
      const att = (attempts ?? []).filter((a) => mine(a) && after(a.attempted_at));
      const attCurrent = att.filter((a) => a.module_version === module.version);
      const prog = (progress ?? []).find(mine) ?? null;
      const progLive = prog && (!resetAt || (prog.updated_at ?? "") > resetAt) ? prog : null;

      const viewedScreens = [...new Set(current.filter((e) => e.event === "viewed").map((e) => e.screen_index ?? -1))];
      const triedScreens = [...new Set(current.filter((e) => e.event === "try_it_done").map((e) => e.screen_index ?? -1))];
      const facts = {
        version: module.version,
        screenCount: screenCount(module.content_md),
        questionCount: counts.get(module.id) ?? 0,
      };
      const learner = {
        viewedScreens,
        passedCurrentVersion: attCurrent.some((a) => a.passed),
        acknowledgedVersion: progLive?.acknowledged_version ?? null,
        everCompletedVersion: progLive?.completed_version ?? null,
        anyActivity: live.length > 0 || att.length > 0,
      };
      const times = [...live.map((e) => e.at), ...att.map((a) => a.attempted_at), progLive?.acknowledged_at ?? ""].filter(Boolean).sort();
      return {
        module,
        screenCount: facts.screenCount,
        questionCount: facts.questionCount,
        status: moduleStatus(facts, learner),
        parts: moduleParts(facts, learner),
        viewedScreens,
        triedScreens,
        bestScore: attCurrent.length ? Math.max(...attCurrent.map((a) => a.score)) : null,
        attempts: attCurrent.length,
        lastActivity: times.pop() ?? null,
        completedAt: progLive?.completed_version === module.version ? progLive.completed_at : null,
      };
    });
    result.set(userId, list);
  }
  return { modules, byUser: result };
}

// Makes sure the learner's progress row exists, without touching it if it does.
export async function ensureProgressRow(userId: string, moduleId: string, client: Client) {
  const { error } = await client
    .from("training_progress")
    .upsert({ user_id: userId, module_id: moduleId, started_at: new Date().toISOString() }, { onConflict: "user_id,module_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

// Writes the worked-out status back to training_progress (for the nav badge
// and reports). Called after every learner action. It never writes the
// sign-off fields (acknowledgeModule owns those), so a status refresh running
// alongside a sign-off can't erase it.
export async function refreshProgress(userId: string, moduleId: string, client: Client = createServiceRoleClient()) {
  await ensureProgressRow(userId, moduleId, client);
  const { byUser } = await loadLearnerModules([userId], client);
  const lm = byUser.get(userId)?.find((m) => m.module.id === moduleId);
  if (!lm) return null;
  const now = new Date().toISOString();
  const update: Database["public"]["Tables"]["training_progress"]["Update"] = {
    status: lm.status,
    module_version: lm.module.version,
    best_score: lm.bestScore,
    updated_at: now,
  };
  if (lm.status === "completed" && lm.completedAt === null) {
    update.completed_at = now;
    update.completed_version = lm.module.version;
  }
  const { error } = await client.from("training_progress").update(update).eq("user_id", userId).eq("module_id", moduleId);
  if (error) throw new Error(error.message);
  return lm;
}

// For the nav badge: "6 of 11 done" for an assigned learner, else null.
export async function learnSummary(userId: string): Promise<{ done: number; total: number } | null> {
  const client = createServiceRoleClient();
  const { data: assigned } = await client.from("training_assignments").select("user_id").eq("user_id", userId).maybeSingle();
  if (!assigned) return null;
  const [modules, { data: progress }] = await Promise.all([
    loadModules(client),
    client.from("training_progress").select("module_id, status, module_version").eq("user_id", userId),
  ]);
  const done = modules.filter((m) =>
    (progress ?? []).some((p) => p.module_id === m.id && p.status === "completed" && p.module_version === m.version),
  ).length;
  return { done, total: modules.length };
}
