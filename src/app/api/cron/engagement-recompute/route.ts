// Vercel Cron target for CLAUDE_engagement_engine_FINAL.md §5's nightly
// pipeline (STEP 1 state recompute + STEP 2 outcome evaluation; STEP 3-5
// join once the queue exists in a later slice). Runs as service role
// (bypasses RLS), exactly like the LLM parser routes and per §2's "the
// nightly job runs as the service role". Schedule lives in vercel.ts.

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runEngagementPipeline } from "@/lib/engagement/pipeline";

export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  try {
    const summary = await runEngagementPipeline(supabase);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Pipeline failed" }, { status: 500 });
  }
}
