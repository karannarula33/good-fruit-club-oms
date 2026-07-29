import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { DateNav } from "@/components/ui/date-nav";
import { PackingScreen, type PackingOrder } from "./packing-screen";

export default async function PackerPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const profile = await requireRole(["packer", "admin"]);

  const params = await searchParams;
  const date = params.date ?? utcToIstDatetimeLocal(new Date()).slice(0, 10);

  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("orders")
    .select("id, customer_id, status")
    .eq("delivery_date", date)
    .in("status", ["recorded", "packed", "cancelled"]);

  const orderIds = (orders ?? []).map((o) => o.id);
  const customerIds = [...new Set((orders ?? []).map((o) => o.customer_id))];

  const [{ data: customers }, { data: orderLines }, { data: products }, { data: billedRows }] = await Promise.all([
    customerIds.length
      ? supabase.from("customers").select("id, display_name, phone, zone").in("id", customerIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? supabase
          .from("order_lines")
          .select("id, order_id, product_id, ordered_qty, ordered_unit, actual_qty, locked_price_per_unit, line_status")
          .in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
    supabase.from("products").select("id, name, unit_type, unit_label").eq("active", true).order("name"),
    orderIds.length
      ? supabase.from("bills").select("order_id").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
  ]);

  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));
  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const billedIds = new Set((billedRows ?? []).map((b) => b.order_id));

  type OrderLineRow = {
    id: string;
    order_id: string;
    product_id: string | null;
    ordered_qty: number | null;
    ordered_unit: string | null;
    actual_qty: number | null;
    locked_price_per_unit: number | null;
    line_status: "pending" | "packed" | "unavailable";
  };
  const linesByOrderId = new Map<string, OrderLineRow[]>();
  for (const line of (orderLines ?? []) as OrderLineRow[]) {
    const list = linesByOrderId.get(line.order_id) ?? [];
    list.push(line);
    linesByOrderId.set(line.order_id, list);
  }

  const packingOrders: PackingOrder[] = (orders ?? [])
    .map((order) => {
      const customer = customerById.get(order.customer_id);
      const lines = (linesByOrderId.get(order.id) ?? [])
        .map((line) => {
          const product = line.product_id ? productById.get(line.product_id) : undefined;
          if (!product) return null;
          return {
            id: line.id,
            productId: product.id,
            productName: product.name,
            unitType: product.unit_type,
            unitLabel: product.unit_label,
            orderedQty: line.ordered_qty,
            orderedUnit: line.ordered_unit,
            actualQty: line.actual_qty,
            lockedPricePerUnit: line.locked_price_per_unit,
            lineStatus: line.line_status,
          };
        })
        .filter((line): line is NonNullable<typeof line> => line !== null);
      return {
        id: order.id,
        status: order.status,
        hasBill: billedIds.has(order.id),
        customerName: customer?.display_name ?? "Unknown customer",
        customerPhone: customer?.phone ?? null,
        zone: customer?.zone ?? "",
        lines,
      };
    })
    .filter((order) => order.lines.length > 0);

  const substituteProducts = (products ?? []).map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="px-[18px] pt-5 pb-4">
      <div className="mb-3 flex justify-end">
        <DateNav date={date} basePath="/packer" />
      </div>
      <PackingScreen
        key={date}
        date={date}
        orders={packingOrders}
        products={substituteProducts}
        isAdmin={profile.role === "admin"}
      />
    </div>
  );
}
