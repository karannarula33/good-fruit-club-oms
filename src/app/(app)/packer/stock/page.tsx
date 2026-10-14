import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { DateNav } from "@/components/ui/date-nav";
import { StockCount, type StockCountRow } from "./stock-count";

// End-of-day leftover-stock count (migration 0030). The packer counts what's
// left after the day's packing; the next day's procurement nets it out. All
// active products are listed so nothing is missed; a fresh count each evening is
// the authoritative stock (no rollover).
export default async function PackerStockPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireRole(["packer", "admin"]);

  const params = await searchParams;
  const date = params.date ?? utcToIstDatetimeLocal(new Date()).slice(0, 10);

  const supabase = await createClient();
  const [{ data: products }, { data: snapshots }] = await Promise.all([
    supabase.from("products").select("id, name, unit_label").eq("active", true).order("name"),
    supabase.from("inventory_snapshots").select("product_id, qty").eq("as_of_date", date),
  ]);

  const qtyByProduct = new Map((snapshots ?? []).map((s) => [s.product_id, s.qty]));

  const rows: StockCountRow[] = (products ?? []).map((p) => ({
    productId: p.id,
    name: p.name,
    unitLabel: p.unit_label,
    qty: qtyByProduct.has(p.id) ? String(qtyByProduct.get(p.id)) : "",
  }));

  return (
    <div className="flex flex-col gap-5 px-[18px] pt-5 pb-6">
      <PageHeader
        title="End-of-Day Stock"
        subtitle="What's left for tomorrow"
        action={<DateNav date={date} basePath="/packer/stock" />}
      />
      <StockCount key={date} date={date} rows={rows} />
    </div>
  );
}
