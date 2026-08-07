// CLAUDE_engagement_engine_FINAL.md §9/§14.5: the draft agent's
// "todays_catalogue_highlights" input should read from real price-version
// data, not be hardcoded. CLAUDE.md §3.2: a price publish only carries the
// items that changed, so the most recently published version's items are
// exactly "what's new today" -- the closest real signal this schema has.
// Run-level (one catalogue, not per-customer), so callers load this once
// per pipeline run and reuse it across every candidate.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

// Sorted for determinism (eval fixtures / tests shouldn't depend on
// Supabase row order) and capped so the prompt stays small.
export function pickHighlights(names: string[], limit: number): string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b)).slice(0, limit);
}

export async function loadTodaysCatalogueHighlights(supabase: Client, limit = 5): Promise<string[]> {
  const { data: latestVersion, error: versionError } = await supabase
    .from("price_versions")
    .select("id")
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (versionError) throw new Error(`Failed to load latest price_version: ${versionError.message}`);
  if (!latestVersion) return [];

  const { data: items, error: itemsError } = await supabase
    .from("price_items")
    .select("products(name, active)")
    .eq("version_id", latestVersion.id);
  if (itemsError) throw new Error(`Failed to load price_items for latest version: ${itemsError.message}`);

  const names = (items ?? [])
    .map((row) => row.products as unknown as { name: string; active: boolean } | null)
    .filter((product): product is { name: string; active: boolean } => product !== null && product.active)
    .map((product) => product.name);

  return pickHighlights(names, limit);
}
