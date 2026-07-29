import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { resolvePrices } from "@/lib/pricing/resolve";
import { loadPriceItemRecords } from "@/lib/pricing/load";
import { loadCatalogEntries } from "@/lib/catalog/load";
import { formatIstDisplay } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
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
      <PageHeader
        title="Prices"
        subtitle="Paste today's price list to publish a new version, or review the active prices below."
      />

      <Table>
        <THead>
          <TR>
            <TH>Product</TH>
            <TH>Unit</TH>
            <TH>Price</TH>
            <TH>As of</TH>
          </TR>
        </THead>
        <TBody>
          {(products ?? []).map((product) => {
            const price = resolved.get(product.id);
            return (
              <TR key={product.id}>
                <TD>{product.name}</TD>
                <TD className="text-neutral-600 dark:text-neutral-400">{product.unit_label ?? product.unit_type}</TD>
                <TD>
                  {price ? `₹${price.pricePerUnit.toFixed(2)}` : <span className="text-danger-text">Not yet priced</span>}
                </TD>
                <TD className="text-neutral-600 dark:text-neutral-400">
                  {price ? formatIstDisplay(price.effectiveFrom) : "—"}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      <PricePasteReview catalog={catalog} />
    </div>
  );
}
