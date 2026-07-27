import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { CatalogEntry } from "@/lib/parser/catalog";

export async function loadCatalogEntries(
  supabase: SupabaseClient<Database>,
): Promise<CatalogEntry[]> {
  const [{ data: products, error: productsError }, { data: aliases, error: aliasesError }] = await Promise.all([
    supabase.from("products").select("id, name, unit_label").eq("active", true),
    supabase.from("product_aliases").select("product_id, alias"),
  ]);
  if (productsError) throw new Error(productsError.message);
  if (aliasesError) throw new Error(aliasesError.message);

  const aliasesByProduct = new Map<string, string[]>();
  for (const row of aliases ?? []) {
    const list = aliasesByProduct.get(row.product_id) ?? [];
    list.push(row.alias);
    aliasesByProduct.set(row.product_id, list);
  }

  return (products ?? []).map((product) => ({
    id: product.id,
    name: product.name,
    aliases: aliasesByProduct.get(product.id) ?? [],
    unitLabel: product.unit_label,
  }));
}
