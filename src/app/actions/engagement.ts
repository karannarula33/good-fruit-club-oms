"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { runEngagementRecompute, type RecomputeSummary } from "@/lib/engagement/recompute";

// Manual trigger for STEP 1 (CLAUDE_engagement_engine_FINAL.md §5), same
// underlying recompute the nightly Vercel Cron job runs -- lets an admin
// force a fresh read (e.g. right after a busy morning of order entry)
// instead of waiting for the next scheduled run.
export async function recomputeEngagementState(): Promise<
  { ok: true; summary: RecomputeSummary } | { ok: false; error: string }
> {
  await requireRole(["admin"]);
  const supabase = await createClient();

  try {
    const summary = await runEngagementRecompute(supabase);
    revalidatePath("/admin/engagement");
    return { ok: true, summary };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Recompute failed" };
  }
}
