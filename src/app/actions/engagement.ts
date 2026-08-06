"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { runEngagementPipeline, type PipelineSummary } from "@/lib/engagement/pipeline";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";

// Manual trigger for the nightly pipeline (CLAUDE_engagement_engine_FINAL.md
// §5), same STEP 1 + STEP 2 + STEP 3/5 the Vercel Cron job runs -- lets an
// admin force a fresh read (e.g. right after a busy morning of order entry)
// instead of waiting for the next scheduled run.
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

type ActionResult = { ok: true } | { ok: false; error: string };

// §10: "Relay -> status='relayed', relayed_at=now (admin then sends from
// Sunita's phone; outcome auto-tracked from orders)." No draft_message
// exists yet this slice (§13 slice 4 adds drafting) -- the admin is relaying
// in their own words, using the rationale as their cue. relayed_at is what
// STEP 2's outcome evaluation keys off, so this is what makes the
// self-tracking loop (slice 2) start producing real data.
export async function relayNudge(nudgeId: string): Promise<ActionResult> {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("eng_nudge_queue")
    .update({ status: "relayed", relayed_at: now, reviewed_at: now })
    .eq("id", nudgeId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/engagement");
  return { ok: true };
}

// §10: "Skip -> skipped (a trigger skipped repeatedly => miscalibrated
// rule, revisit §3)."
export async function skipNudge(nudgeId: string): Promise<ActionResult> {
  await requireRole(["admin"]);
  const supabase = await createClient();

  const { error } = await supabase
    .from("eng_nudge_queue")
    .update({ status: "skipped", reviewed_at: new Date().toISOString() })
    .eq("id", nudgeId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/engagement");
  return { ok: true };
}

// §10: "Snooze -> set snooze_until, re-surface then." Fixed 3-day quick
// action, matching the single [Snooze 3d] button in the spec's own mockup.
export async function snoozeNudge(nudgeId: string): Promise<ActionResult> {
  await requireRole(["admin"]);
  const supabase = await createClient();

  const snoozeUntil = new Date(Date.now() + 3 * 86_400_000);
  const snoozeUntilIso = utcToIstDatetimeLocal(snoozeUntil).slice(0, 10);

  const { error } = await supabase
    .from("eng_nudge_queue")
    .update({ status: "snoozed", snooze_until: snoozeUntilIso, reviewed_at: new Date().toISOString() })
    .eq("id", nudgeId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/engagement");
  return { ok: true };
}
