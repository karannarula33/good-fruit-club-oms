// One-off (and safe to re-run): reads city / area / society from every
// customer's address that doesn't have one yet (migration 0039), using the
// same rules + Claude fallback as the app (src/lib/customers/fill-areas.ts).
// Manual areas are never touched.
//
// Usage: npx tsx --env-file=.env.local scripts/backfill_customer_areas.ts

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { fillCustomerAreas } from "@/lib/customers/fill-areas";

async function main() {
  const supabase = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const summary = await fillCustomerAreas(supabase, { limit: 5000 });
  console.log(summary);
}

main().catch((e) => { console.error(e); process.exit(1); });
