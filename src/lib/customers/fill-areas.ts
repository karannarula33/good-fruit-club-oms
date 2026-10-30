// Fills customers.city / area / locality from the address (migration 0039).
// Picks customers with no area yet, or an auto area read from an address
// that has since changed; never touches a manual one. Rules first (free,
// instant), Claude for the rest. Runs:
//   * right after a new customer is created (orders.ts, via after()),
//   * nightly from /api/cron/customer-areas (catches website-ingested
//     customers and anything that failed),
//   * once for the backfill (scripts/backfill_customer_areas.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { KNOWN_AREAS, matchArea, type AreaResult } from "./area";
import { UNASSIGNED_ZONE, ZONE_ORDER, zoneForArea } from "./zone";
import { resolveAreaWithClaude } from "@/lib/parser/resolve-area";

type Client = SupabaseClient<Database>;

// A customer keeps the zone they have. The zone follows the area only when
// they have none yet, or when it was itself taken from their previous area
// (so an address change moves an area-based zone, but never an original one
// like "DLF Phase 2" that was set before).
export function nextZone(
  c: { zone: string | null; area: string | null; locality: string | null },
  result: { area: string | null; locality: string | null } | null,
): string {
  const current = c.zone || UNASSIGNED_ZONE;
  if (ZONE_ORDER.includes(current)) return current; // original zones are never moved automatically
  const followsArea = current === UNASSIGNED_ZONE || (c.area !== null && current === zoneForArea(c.area, c.locality));
  if (!followsArea) return current;
  return result ? zoneForArea(result.area, result.locality) : current;
}

export interface FillSummary { checked: number; byRules: number; byClaude: number; unknown: number; failed: number }

export async function fillCustomerAreas(
  supabase: Client,
  opts: { customerIds?: string[]; limit?: number; useClaude?: boolean } = {},
): Promise<FillSummary> {
  const { customerIds, limit = 200, useClaude = true } = opts;
  const base = supabase.from("customers").select("id, address, zone, area, locality, area_source, area_resolved_for");
  // Not-manual, written out because neq() would also drop the NULL rows.
  const { data: rows, error } = await (customerIds?.length
    ? base.in("id", customerIds)
    : base.or("area_source.is.null,area_source.eq.auto"));
  if (error) throw new Error(error.message);

  const todo = (rows ?? [])
    .filter((c) => c.area_source !== "manual")
    .filter((c) => c.area_source === null || c.area_resolved_for !== c.address)
    .slice(0, limit);

  const summary: FillSummary = { checked: todo.length, byRules: 0, byClaude: 0, unknown: 0, failed: 0 };
  if (todo.length === 0) return summary;

  const { data: existing } = await supabase.from("customers").select("area").not("area", "is", null);
  const known = [...new Set([...KNOWN_AREAS, ...(existing ?? []).map((r) => r.area as string)])].sort();

  for (const c of todo) {
    const address = c.address ?? "";
    let result: AreaResult | null = matchArea(address);
    if (result) summary.byRules++;
    else if (useClaude && address.trim()) {
      try {
        result = await resolveAreaWithClaude(address, known);
        summary.byClaude++;
        if (result.area && !known.includes(result.area)) known.push(result.area);
      } catch {
        summary.failed++;
        continue; // try again on the next run
      }
    }
    if (!result || !result.area) summary.unknown++;
    const { error: upErr } = await supabase
      .from("customers")
      .update({
        city: result?.city ?? null,
        area: result?.area ?? null,
        locality: result?.locality ?? null,
        area_source: "auto",
        area_resolved_for: address,
        zone: nextZone(c, result),
      })
      .eq("id", c.id);
    if (upErr) summary.failed++;
  }
  return summary;
}
