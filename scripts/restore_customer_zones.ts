// One-off (2026-10-31): puts back the zones that migration 0039 overwrote.
//   1. Customers in the 28 Sep 2026 export keep the zone they had there
//      (that export also holds zones the admin set by hand, e.g. "Outside
//      Gurgaon", "Near Hamilton Court").
//   2. Everyone else gets the zone the original address rules give.
//   3. Anyone still "Unassigned" is then tagged from their area by
//      scripts/backfill_customer_areas.ts (rules + Claude).
//
// Input: a text file of "<customer_id>|<zone>" lines (only non-Unassigned
// zones), taken from that export. Dry run unless --execute.
//
// Usage: npx tsx --env-file=.env.local scripts/restore_customer_zones.ts <zones.txt> [--execute]

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { UNASSIGNED_ZONE, ZONE_ORDER } from "@/lib/customers/zone";

const ORIGINAL_RULES: [RegExp, string][] = [
  [/heritage city|the vilas|dlf[\s-]*phase[\s-]*2\b|dlf[\s-]*2\b/, "DLF Phase 2"],
  [/sushant lok/, "Sushant Lok"],
  [/hamilton court/, "Near Hamilton Court"],
  [/dlf[\s-]*phase[\s-]*1\b|dlf[\s-]*1\b|dlf[\s-]*i\b/, "DLF Phase 1"],
  [/dlf[\s-]*phase[\s-]*3\b|dlf[\s-]*3\b/, "Phase 3"],
  [/dlf[\s-]*phase[\s-]*4\b|dlf[\s-]*4\b/, "Phase 4"],
  [/dlf[\s-]*phase[\s-]*5\b|dlf[\s-]*5\b/, "Phase 5"],
];
const originalZone = (address: string) => ORIGINAL_RULES.find(([re]) => re.test(address.toLowerCase()))?.[1] ?? UNASSIGNED_ZONE;

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file) throw new Error("usage: restore_customer_zones.ts <zones.txt> [--execute]");
  const exported = new Map(
    readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => l.split("|") as [string, string]),
  );
  for (const z of exported.values()) if (!ZONE_ORDER.includes(z)) throw new Error(`Unexpected zone in export: ${z}`);

  const supabase = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: customers, error } = await supabase.from("customers").select("id, address, zone");
  if (error) throw new Error(error.message);

  const plan = customers!.map((c) => ({ id: c.id, from: c.zone, to: exported.get(c.id) ?? originalZone(c.address), source: exported.has(c.id) ? "export" : "rules" }));
  const counts: Record<string, number> = {};
  for (const p of plan) counts[p.to] = (counts[p.to] ?? 0) + 1;
  console.log(`customers: ${plan.length}; from 28 Sep export: ${plan.filter((p) => p.source === "export").length}`);
  console.log(counts);

  if (flag !== "--execute") { console.log("dry run -- pass --execute to write."); return; }
  let n = 0;
  for (const p of plan.filter((p) => p.from !== p.to)) {
    const { error: e } = await supabase.from("customers").update({ zone: p.to }).eq("id", p.id);
    if (e) throw new Error(e.message);
    n++;
  }
  console.log(`updated ${n} customers.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
