import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { PriceItemRecord, TierRecord } from "@/lib/pricing/resolve";

export async function loadPriceItemRecords(
  supabase: SupabaseClient<Database>,
): Promise<PriceItemRecord[]> {
  const { data, error } = await supabase
    .from("price_items")
    .select("id, product_id, price_per_unit, price_versions(effective_from, created_at)");
  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((row) => row.price_versions)
    .map((row) => ({
      priceItemId: row.id,
      productId: row.product_id,
      pricePerUnit: row.price_per_unit,
      effectiveFrom: new Date((row.price_versions as unknown as { effective_from: string }).effective_from),
      versionCreatedAt: new Date((row.price_versions as unknown as { created_at: string }).created_at),
    }));
}

export async function loadPriceTierRecords(
  supabase: SupabaseClient<Database>,
): Promise<TierRecord[]> {
  const { data, error } = await supabase.from("price_tiers").select("price_item_id, min_qty, price_per_unit");
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    priceItemId: row.price_item_id,
    minQty: row.min_qty,
    pricePerUnit: row.price_per_unit,
  }));
}
