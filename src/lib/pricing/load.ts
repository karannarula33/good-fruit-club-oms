import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { PriceItemRecord } from "@/lib/pricing/resolve";

export async function loadPriceItemRecords(
  supabase: SupabaseClient<Database>,
): Promise<PriceItemRecord[]> {
  const { data, error } = await supabase
    .from("price_items")
    .select("product_id, price_per_unit, price_versions(effective_from, created_at)");
  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((row) => row.price_versions)
    .map((row) => ({
      productId: row.product_id,
      pricePerUnit: row.price_per_unit,
      effectiveFrom: new Date((row.price_versions as unknown as { effective_from: string }).effective_from),
      versionCreatedAt: new Date((row.price_versions as unknown as { created_at: string }).created_at),
    }));
}
