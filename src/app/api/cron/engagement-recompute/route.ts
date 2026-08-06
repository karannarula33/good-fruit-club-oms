// Vercel Cron target for CLAUDE_engagement_engine_FINAL.md §5 STEP 1 --
// unconditional nightly recompute of eng_customer_state for every customer.
// Runs as service role (bypasses RLS), exactly like the LLM parser routes
// and per §2's "the nightly job runs as the service role". Schedule lives in
// vercel.ts.

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runEngagementRecompute } from "@/lib/engagement/recompute";

export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  try {
    const summary = await runEngagementRecompute(supabase);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Recompute failed" }, { status: 500 });
  }
}
