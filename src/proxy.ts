import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Excludes /api: API routes (e.g. the cron-triggered engagement recompute)
    // authenticate themselves and must never be redirected to /login -- a
    // Vercel Cron request has no Supabase session cookie, so without this
    // exclusion updateSession would 307 every cron hit before it ever
    // reached the route handler's CRON_SECRET check.
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon-192|icon-512|apple-icon|icon$).*)",
  ],
};
