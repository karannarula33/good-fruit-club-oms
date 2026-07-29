import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { resolvePrices } from "@/lib/pricing/resolve";
import { loadPriceItemRecords } from "@/lib/pricing/load";
import { loadCatalogEntries } from "@/lib/catalog/load";
import { formatIstDisplay } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
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
    <div className="flex flex-col gap-5 px-[18px] pt-5 pb-6">
      <PageHeader title="Prices" subtitle="Paste today's vendor price message" />

      <div className="flex flex-col gap-2">
        {(products ?? []).map((product) => {
          const price = resolved.get(product.id);
          return (
            <Card key={product.id} elevated className="flex items-center justify-between !space-y-0">
              <div>
                <div className="font-sans text-sm font-bold text-foreground">{product.name}</div>
                <div className="font-sans text-[11.5px] font-semibold text-muted">
                  per {product.unit_label ?? product.unit_type}
                  {price && ` · as of ${formatIstDisplay(price.effectiveFrom)}`}
                </div>
              </div>
              <div className="font-display text-[15px] font-bold text-foreground">
                {price ? `₹${price.pricePerUnit.toFixed(2)}` : <span className="text-danger-text">Not priced</span>}
              </div>
            </Card>
          );
        })}
      </div>

      <PricePasteReview catalog={catalog} />
    </div>
  );
}
