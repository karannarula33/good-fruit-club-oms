"use server";

// Learn GFC (onboarding) actions. The learner's browser never writes the
// training tables: these actions check who is calling, work out the result
// on the server (quiz grading, completion) and write with the service role.
// See supabase/migrations/0042_training.sql and src/lib/training/.

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { gradeQuiz, PASS_MARK } from "@/lib/training/progress";
import { ensureProgressRow, loadLearnerModules, refreshProgress } from "@/lib/training/load";
import { screenCount } from "@/lib/training/markdown";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const ALL_ROLES = ["admin", "packer", "delivery", "engagement"] as const;

// The caller, if they're assigned the onboarding. An unassigned admin can
// preview it (preview: true): nothing they do is recorded.
async function requireLearner() {
  const profile = await requireRole([...ALL_ROLES]);
  const client = createServiceRoleClient();
  const { data } = await client.from("training_assignments").select("user_id").eq("user_id", profile.id).maybeSingle();
  if (!data && profile.role !== "admin") throw new Error("Learn GFC isn't assigned to you yet.");
  return { profile, client, preview: !data };
}

async function getModule(client: ReturnType<typeof createServiceRoleClient>, moduleId: string) {
  const { data } = await client
    .from("training_modules")
    .select("id, slug, version, content_md, is_active")
    .eq("id", moduleId)
    .maybeSingle();
  if (!data || !data.is_active) throw new Error("Module not found.");
  return data;
}

function fail(e: unknown): { ok: false; error: string } {
  unstable_rethrow(e); // let Next's redirect-to-login through
  return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
}

export async function recordTrainingEvent(
  moduleId: string,
  screenIndex: number,
  event: "viewed" | "try_it_done",
): Promise<Result> {
  try {
    const { profile, client, preview } = await requireLearner();
    const m = await getModule(client, moduleId);
    if (preview) return { ok: true };
    if (!Number.isInteger(screenIndex) || screenIndex < 0 || screenIndex >= screenCount(m.content_md)) {
      return { ok: false, error: "Unknown screen." };
    }
    const { error } = await client.from("training_events").insert({
      user_id: profile.id,
      module_id: moduleId,
      module_version: m.version,
      screen_index: screenIndex,
      event,
    });
    if (error) return { ok: false, error: error.message };
    await refreshProgress(profile.id, moduleId, client);
    revalidatePath("/learn");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export interface QuizQuestion {
  id: string;
  kind: "mcq" | "scenario";
  scenario: string | null;
  prompt: string;
  options: string[];
}

// The quick check, without the answers.
export async function getQuiz(moduleId: string): Promise<Result<{ questions: QuizQuestion[] }>> {
  try {
    const { client } = await requireLearner();
    await getModule(client, moduleId);
    const { data, error } = await client
      .from("training_questions")
      .select("id, kind, scenario, prompt, options")
      .eq("module_id", moduleId)
      .eq("is_active", true)
      .order("order_index");
    if (error) return { ok: false, error: error.message };
    return { ok: true, questions: (data ?? []) as QuizQuestion[] };
  } catch (e) {
    return fail(e);
  }
}

export interface QuizFeedback {
  questionId: string;
  chosen: number | null;
  correctIndex: number;
  correct: boolean;
  explanation: string;
}

export async function submitQuiz(
  moduleId: string,
  answers: Record<string, number>,
): Promise<Result<{ score: number; correct: number; total: number; passed: boolean; passMark: number; feedback: QuizFeedback[] }>> {
  try {
    const { profile, client, preview } = await requireLearner();
    const m = await getModule(client, moduleId);
    const { data: qs, error } = await client
      .from("training_questions")
      .select("id, correct_index, explanation")
      .eq("module_id", moduleId)
      .eq("is_active", true)
      .order("order_index");
    if (error) return { ok: false, error: error.message };
    const questions = (qs ?? []).map((q) => ({ id: q.id, correctIndex: q.correct_index, explanation: q.explanation }));
    const g = gradeQuiz(questions, answers ?? {});
    // The right answers and explanations are shown only once the check is
    // passed; a failed try only says which questions were wrong.
    const feedback: QuizFeedback[] = g.detail.map((d, i) => ({
      ...d,
      correctIndex: g.passed ? questions[i].correctIndex : -1,
      explanation: g.passed ? questions[i].explanation : "",
    }));
    const summary = { score: g.score, correct: g.correct, total: g.total, passed: g.passed, passMark: PASS_MARK, feedback };
    if (preview) return { ok: true, ...summary };
    const { error: insErr } = await client.from("training_attempts").insert({
      user_id: profile.id,
      module_id: moduleId,
      module_version: m.version,
      score: g.score,
      correct: g.correct,
      total: g.total,
      passed: g.passed,
      answers: g.detail,
    });
    if (insErr) return { ok: false, error: insErr.message };
    await refreshProgress(profile.id, moduleId, client);
    revalidatePath("/learn");
    return { ok: true, ...summary };
  } catch (e) {
    return fail(e);
  }
}

// "I've read and understood this" -- only once every screen is viewed and the
// quick check is passed for the current version.
export async function acknowledgeModule(moduleId: string): Promise<Result> {
  try {
    const { profile, client, preview } = await requireLearner();
    const m = await getModule(client, moduleId);
    if (preview) return { ok: true };
    const { byUser } = await loadLearnerModules([profile.id], client);
    const lm = byUser.get(profile.id)?.find((x) => x.module.id === moduleId);
    if (!lm) return { ok: false, error: "Module not found." };
    if (!lm.parts.screensDone) return { ok: false, error: "Go through every screen first." };
    if (!lm.parts.quizDone) return { ok: false, error: `Pass the quick check (${PASS_MARK}%) first.` };
    const now = new Date().toISOString();
    await ensureProgressRow(profile.id, moduleId, client);
    const { error } = await client
      .from("training_progress")
      .update({ acknowledged_at: now, acknowledged_version: m.version, updated_at: now })
      .eq("user_id", profile.id)
      .eq("module_id", moduleId);
    if (error) return { ok: false, error: error.message };
    await refreshProgress(profile.id, moduleId, client);
    revalidatePath("/learn");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---- Admin ----

async function requireAdmin() {
  const profile = await requireRole(["admin"]);
  return { profile, client: createServiceRoleClient() };
}

export async function assignTraining(userId: string, assign: boolean): Promise<Result> {
  try {
    const { profile, client } = await requireAdmin();
    const { error } = assign
      ? await client.from("training_assignments").upsert({ user_id: userId, assigned_by: profile.id })
      : await client.from("training_assignments").delete().eq("user_id", userId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin/training");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Start a module again for one learner: their earlier views, attempts and
// acknowledgement stop counting (they stay in the history).
export async function resetTrainingModule(userId: string, moduleId: string): Promise<Result> {
  try {
    const { client } = await requireAdmin();
    const m = await getModule(client, moduleId);
    const { error: delErr } = await client.from("training_progress").delete().eq("user_id", userId).eq("module_id", moduleId);
    if (delErr) return { ok: false, error: delErr.message };
    const { error } = await client.from("training_events").insert({
      user_id: userId,
      module_id: moduleId,
      module_version: m.version,
      screen_index: null,
      event: "reset",
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin/training");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Edit a module's lesson. Any change to the content bumps the version, so
// learners who finished it are asked to review it again.
export async function updateTrainingModule(
  moduleId: string,
  input: { title: string; summary: string; contentMd: string },
): Promise<Result<{ version: number }>> {
  try {
    const { profile, client } = await requireAdmin();
    const title = input.title.trim();
    if (!title) return { ok: false, error: "Give the module a title." };
    const screens = screenCount(input.contentMd);
    if (screens === 0) return { ok: false, error: "The lesson needs at least one screen." };
    const { data: cur } = await client.from("training_modules").select("version, content_md, title, summary").eq("id", moduleId).maybeSingle();
    if (!cur) return { ok: false, error: "Module not found." };
    const changed = cur.content_md !== input.contentMd;
    const version = changed ? cur.version + 1 : cur.version;
    const { error } = await client
      .from("training_modules")
      .update({
        title,
        summary: input.summary.trim(),
        content_md: input.contentMd,
        version,
        updated_at: new Date().toISOString(),
        updated_by: profile.id,
      })
      .eq("id", moduleId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin/training");
    revalidatePath("/learn");
    return { ok: true, version };
  } catch (e) {
    return fail(e);
  }
}
