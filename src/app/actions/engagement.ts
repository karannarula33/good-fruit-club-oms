"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { runEngagementPipeline, type PipelineSummary } from "@/lib/engagement/pipeline";

// Manual trigger for the nightly pipeline (CLAUDE_engagement_engine_FINAL.md
// §5), same STEP 1 + STEP 2 the Vercel Cron job runs -- lets an admin force
// a fresh read (e.g. right after a busy morning of order entry) instead of
// waiting for the next scheduled run.
export async function recomputeEngagementState(): Promise<
  { ok: true; summary: PipelineSummary } | { ok: false; error: string }
> {
  await requireRole(["admin"]);
  const supabase = await createClient();

  try {
    const summary = await runEngagementPipeline(supabase);
    revalidatePath("/admin/engagement");
    return { ok: true, summary };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Recompute failed" };
  }
}
