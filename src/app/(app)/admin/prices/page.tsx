import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { resolvePrices } from "@/lib/pricing/resolve";
import { loadPriceItemRecords, loadPriceTierRecords } from "@/lib/pricing/load";
import { loadCatalogEntries } from "@/lib/catalog/load";
import { formatIstDisplay } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PriceQuickEdit } from "@/components/price-quick-edit";
import { PricePasteReview } from "./price-paste-review";

export default async function AdminPricesPage() {
  await requireRole(["admin"]);

  const supabase = await createClient();

  const [{ data: products }, priceItems, tierItems, catalog] = await Promise.all([
    supabase.from("products").select("id, name, unit_type, unit_label").eq("active", true).order("name"),
    loadPriceItemRecords(supabase),
    loadPriceTierRecords(supabase),
    loadCatalogEntries(supabase),
  ]);

  const resolved = resolvePrices(priceItems, new Date());
  const tierCountByPriceItemId = new Map<string, number>();
  for (const tier of tierItems) {
    tierCountByPriceItemId.set(tier.priceItemId, (tierCountByPriceItemId.get(tier.priceItemId) ?? 0) + 1);
  }

  return (
    <div className="flex flex-col gap-5 px-[18px] pt-5 pb-6">
      <PageHeader
        title="Prices"
        subtitle="Paste today's vendor price message, or tap a price to edit it directly"
        action={
          <Button href="/admin/catalog" variant="outline" size="sm">
            Manage catalog →
          </Button>
        }
      />

      <div className="flex flex-col gap-2">
        {(products ?? []).map((product) => {
          const price = resolved.get(product.id);
          const tierCount = price ? (tierCountByPriceItemId.get(price.priceItemId) ?? 0) : 0;
          return (
            <Card key={product.id} elevated className="flex items-center justify-between !space-y-0">
              <div>
                <div className="font-sans text-sm font-bold text-foreground">{product.name}</div>
                <div className="font-sans text-[11.5px] font-semibold text-muted">
                  per {product.unit_label ?? product.unit_type}
                  {price && ` · as of ${formatIstDisplay(price.effectiveFrom)}`}
                  {tierCount > 0 && ` · ${tierCount} tier${tierCount === 1 ? "" : "s"}`}
                </div>
              </div>
              <PriceQuickEdit productId={product.id} currentPrice={price?.pricePerUnit ?? null} />
            </Card>
          );
        })}
      </div>

      <PricePasteReview catalog={catalog} />
    </div>
  );
}
