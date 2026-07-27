import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { resolvePrices } from "@/lib/pricing/resolve";
import { loadPriceItemRecords } from "@/lib/pricing/load";
import { loadCatalogEntries } from "@/lib/catalog/load";
import { formatIstDisplay } from "@/lib/time/ist";
import { PricePasteReview } from "./price-paste-review";

export default async function AdminPricesPage() {
  await requireRole(["admin"]);

  const supabase = await createClient();

  const [{ data: products }, priceItems, catalog] = await Promise.all([
    supabase.from("products").select("id, name, unit_type, unit_label").eq("active", true).order("name"),
    loadPriceItemRecords(supabase),
    loadCatalogEntries(supabase),
  ]);

  const resolved = resolvePrices(priceItems, new Date());

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
