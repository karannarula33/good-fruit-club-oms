import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { resolvePrices, type PriceItemRecord } from "@/lib/pricing/resolve";
import { formatIstDisplay } from "@/lib/time/ist";
import { PricePasteReview } from "./price-paste-review";

export default async function AdminPricesPage() {
  await requireRole(["admin"]);

  const supabase = await createClient();

  const [{ data: products }, { data: priceItemRows }, { data: aliasRows }] = await Promise.all([
    supabase.from("products").select("id, name, unit_type, unit_label").eq("active", true).order("name"),
    supabase
      .from("price_items")
      .select("product_id, price_per_unit, price_versions(effective_from, created_at)"),
    supabase.from("product_aliases").select("product_id, alias"),
  ]);

  const priceItems: PriceItemRecord[] = (priceItemRows ?? [])
    .filter((row) => row.price_versions)
    .map((row) => ({
      productId: row.product_id,
      pricePerUnit: row.price_per_unit,
      effectiveFrom: new Date((row.price_versions as unknown as { effective_from: string }).effective_from),
      versionCreatedAt: new Date((row.price_versions as unknown as { created_at: string }).created_at),
    }));

  const resolved = resolvePrices(priceItems, new Date());

  const aliasesByProduct = new Map<string, string[]>();
  for (const row of aliasRows ?? []) {
    const list = aliasesByProduct.get(row.product_id) ?? [];
    list.push(row.alias);
    aliasesByProduct.set(row.product_id, list);
  }

  const catalog = (products ?? []).map((product) => ({
    id: product.id,
    name: product.name,
    aliases: aliasesByProduct.get(product.id) ?? [],
  }));

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Prices</h1>
        <p className="text-neutral-600">
          Paste today&apos;s price list to publish a new version, or review the active prices below.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-neutral-300 rounded-md">
          <thead>
            <tr className="bg-neutral-100 text-left">
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2">Price</th>
              <th className="px-3 py-2">As of</th>
            </tr>
          </thead>
          <tbody>
            {(products ?? []).map((product) => {
              const price = resolved.get(product.id);
              return (
                <tr key={product.id} className="border-t border-neutral-200">
                  <td className="px-3 py-2">{product.name}</td>
                  <td className="px-3 py-2 text-neutral-600">{product.unit_label ?? product.unit_type}</td>
                  <td className="px-3 py-2">
                    {price ? `₹${price.pricePerUnit.toFixed(2)}` : (
                      <span className="text-red-600">Not yet priced</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-neutral-600">
                    {price ? formatIstDisplay(price.effectiveFrom) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <PricePasteReview catalog={catalog} />
    </div>
  );
}
