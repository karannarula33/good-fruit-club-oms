// For scripts run outside the request lifecycle (manual eval/import
// scripts) -- bypasses RLS, never import this from app code. Single
// exception: the Razorpay webhook (src/app/api/razorpay/webhook/route.ts),
// which has no signed-in user and authenticates by request signature.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return createClient<Database>(url, serviceRoleKey);
}
