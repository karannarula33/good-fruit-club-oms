// Vercel Cron: fills customers.city / area / locality for anyone still
// missing one (e.g. customers created by the website ingestion) or whose
// address changed since it was read. See src/lib/customers/fill-areas.ts.
// Schedule lives in vercel.ts.

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { fillCustomerAreas } from "@/lib/customers/fill-areas";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await fillCustomerAreas(createServiceRoleClient(), { limit: 40 });
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
