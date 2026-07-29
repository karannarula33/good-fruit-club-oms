import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { aggregateProcurement, type ProcurementLine } from "@/lib/procurement/aggregate";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { DateNav } from "@/components/ui/date-nav";
import { ProcurementChecklist, type ProcurementDisplayRow } from "./procurement-checklist";

export default async function AdminProcurementPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireRole(["admin"]);

  const params = await searchParams;
  const date = params.date ?? utcToIstDatetimeLocal(new Date()).slice(0, 10);

  const supabase = await createClient();

  const [{ data: orders }, { data: products }, { data: checks }] = await Promise.all([
    supabase.from("orders").select("id, customer_id").eq("delivery_date", date).neq("status", "cancelled"),
    supabase.from("products").select("id, name, unit_label"),
    supabase.from("procurement_item_checks").select("product_id, checked_qty").eq("delivery_date", date),
  ]);

  const orderIds = (orders ?? []).map((o) => o.id);
  const customerIds = [...new Set((orders ?? []).map((o) => o.customer_id))];
  const customerIdByOrderId = new Map((orders ?? []).map((o) => [o.id, o.customer_id]));

  const { data: customers } = customerIds.length
    ? await supabase.from("customers").select("id, display_name").in("id", customerIds)
    : { data: [] };
  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));

  const { data: orderLines } = orderIds.length
    ? await supabase.from("order_lines").select("order_id, product_id, ordered_qty").in("order_id", orderIds)
    : { data: [] };

  const lines: ProcurementLine[] = (orderLines ?? [])
    .filter((line) => line.product_id && line.ordered_qty !== null)
    .map((line) => {
      const customerId = customerIdByOrderId.get(line.order_id);
      const customerName = customerId ? (customerById.get(customerId)?.display_name ?? "Unknown") : "Unknown";
      return {
        productId: line.product_id as string,
        qty: line.ordered_qty as number,
        customerName,
      };
    });

  const checkedQtyByProduct = new Map((checks ?? []).map((c) => [c.product_id, c.checked_qty]));

  const rows = aggregateProcurement(lines, checkedQtyByProduct);

  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const displayRows: ProcurementDisplayRow[] = rows
    .map((row) => {
      const product = productById.get(row.productId);
      if (!product) return null;
      return {
        productId: row.productId,
        name: product.name,
        unitLabel: product.unit_label,
        totalQty: row.totalQty,
        extraQty: row.extraQty,
        contributions: row.contributions,
        checked: checkedQtyByProduct.has(row.productId),
      };
    })
    .filter((row): row is ProcurementDisplayRow => row !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-5 px-[18px] pt-5 pb-6">
      <PageHeader
        title="Procurement"
        subtitle="Before the mandi run"
        action={<DateNav date={date} basePath="/admin/procurement" />}
      />

      <ProcurementChecklist date={date} rows={displayRows} />
    </div>
  );
}
