import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { resolvePrices } from "@/lib/pricing/resolve";
import { loadPriceItemRecords, loadPriceTierRecords } from "@/lib/pricing/load";
import { PageHeader } from "@/components/ui/page-header";
import { CatalogManager, type CatalogProduct } from "./catalog-manager";

export default async function AdminCatalogPage() {
  await requireRole(["admin"]);

  const supabase = await createClient();

  const [{ data: products }, priceItems, tierItems] = await Promise.all([
    supabase.from("products").select("id, name, unit_type, unit_label, active").order("name"),
    loadPriceItemRecords(supabase),
    loadPriceTierRecords(supabase),
  ]);

  const resolved = resolvePrices(priceItems, new Date());

  const historyByProduct = new Map<string, { pricePerUnit: number; effectiveFrom: string }[]>();
  for (const item of priceItems) {
    const list = historyByProduct.get(item.productId) ?? [];
    list.push({ pricePerUnit: item.pricePerUnit, effectiveFrom: item.effectiveFrom.toISOString() });
    historyByProduct.set(item.productId, list);
  }
  for (const list of historyByProduct.values()) {
    list.sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime());
  }

  const tiersByPriceItemId = new Map<string, { minQty: number; pricePerUnit: number }[]>();
  for (const tier of tierItems) {
    const list = tiersByPriceItemId.get(tier.priceItemId) ?? [];
    list.push({ minQty: tier.minQty, pricePerUnit: tier.pricePerUnit });
    tiersByPriceItemId.set(tier.priceItemId, list);
  }
  for (const list of tiersByPriceItemId.values()) {
    list.sort((a, b) => a.minQty - b.minQty);
  }

  const catalogProducts: CatalogProduct[] = (products ?? []).map((product) => {
    const current = resolved.get(product.id);
    return {
      id: product.id,
      name: product.name,
      unitType: product.unit_type,
      unitLabel: product.unit_label,
      active: product.active,
      currentPrice: current?.pricePerUnit ?? null,
      history: historyByProduct.get(product.id) ?? [],
      tiers: current ? (tiersByPriceItemId.get(current.priceItemId) ?? []) : [],
    };
  });

  return (
    <div className="flex flex-col gap-5 px-[18px] pt-5 pb-6">
      <PageHeader
        title="Catalog"
        subtitle="Add, edit, and deactivate fruits — see each one's price history"
        backHref="/admin/prices"
        backLabel="Prices"
      />
      <CatalogManager products={catalogProducts} />
    </div>
  );
}
