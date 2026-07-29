import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { DateNav } from "@/components/ui/date-nav";
import { ManageOrdersList, type ManageOrderRow } from "./manage-orders-list";
import type { OrderStatus } from "@/lib/supabase/database.types";

export default async function ManageOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireRole(["admin"]);

  const params = await searchParams;
  const date = params.date ?? utcToIstDatetimeLocal(new Date()).slice(0, 10);

  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("orders")
    .select("id, customer_id, status")
    .eq("delivery_date", date)
    .order("created_at", { ascending: false });

  const orderIds = (orders ?? []).map((o) => o.id);
  const customerIds = [...new Set((orders ?? []).map((o) => o.customer_id))];

  const [{ data: customers }, { data: orderLines }, { data: products }, { data: bills }] = await Promise.all([
    customerIds.length
      ? supabase.from("customers").select("id, display_name").in("id", customerIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? supabase.from("order_lines").select("id, order_id, product_id, ordered_qty, ordered_unit").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
    supabase.from("products").select("id, name, unit_label"),
    orderIds.length
      ? supabase.from("bills").select("order_id, total").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
  ]);

  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));
  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const billByOrderId = new Map((bills ?? []).map((b) => [b.order_id, b.total]));

  const linesByOrderId = new Map<string, { id: string; product_id: string | null; ordered_qty: number | null; ordered_unit: string | null }[]>();
  for (const line of orderLines ?? []) {
    const list = linesByOrderId.get(line.order_id) ?? [];
    list.push(line);
    linesByOrderId.set(line.order_id, list);
  }

  const rows: ManageOrderRow[] = (orders ?? []).map((order) => {
    const customer = customerById.get(order.customer_id);
    const lines = (linesByOrderId.get(order.id) ?? []).map((line) => {
      const product = line.product_id ? productById.get(line.product_id) : undefined;
      return {
        id: line.id,
        productName: product?.name ?? "Unknown product",
        unitLabel: product?.unit_label ?? null,
        orderedQty: line.ordered_qty,
        orderedUnit: line.ordered_unit,
      };
    });
    return {
      id: order.id,
      customerName: customer?.display_name ?? "Unknown customer",
      status: order.status as OrderStatus,
      hasBill: billByOrderId.has(order.id),
      billTotal: billByOrderId.get(order.id) ?? null,
      lines,
    };
  });

  return (
    <div className="flex flex-col gap-5 px-[18px] pt-5 pb-6">
      <PageHeader
        title="Manage Orders"
        subtitle="Delete test or wrongly entered orders"
        action={<DateNav date={date} basePath="/admin/manage-orders" />}
      />
      <ManageOrdersList rows={rows} />
    </div>
  );
}
