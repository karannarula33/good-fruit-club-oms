import { motion } from "motion/react";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { PackingOrderCard } from "./packing-order-card";

export default async function PackerPage() {
  await requireRole(["packer", "admin"]);

  const supabase = await createClient();
  const today = utcToIstDatetimeLocal(new Date()).slice(0, 10);

  const { data: orders } = await supabase
    .from("orders")
    .select("id, customer_id")
    .eq("delivery_date", today)
    .eq("status", "recorded");

  const orderIds = (orders ?? []).map((o) => o.id);
  const customerIds = [...new Set((orders ?? []).map((o) => o.customer_id))];

  const { data: customers } = customerIds.length
    ? await supabase.from("customers").select("id, display_name, zone").in("id", customerIds)
    : { data: [] };
  const { data: orderLines } = orderIds.length
    ? await supabase
        .from("order_lines")
        .select("id, order_id, product_id, ordered_qty, ordered_unit")
        .in("order_id", orderIds)
    : { data: [] };
  const { data: products } = await supabase
    .from("products")
    .select("id, name, unit_type, unit_label")
    .eq("active", true)
    .order("name");

  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));
  const productById = new Map((products ?? []).map((p) => [p.id, p]));

  type OrderLineRow = {
    id: string;
    order_id: string;
    product_id: string | null;
    ordered_qty: number | null;
    ordered_unit: string | null;
  };
  const linesByOrderId = new Map<string, OrderLineRow[]>();
  for (const line of orderLines ?? []) {
    const list = linesByOrderId.get(line.order_id) ?? [];
    list.push(line);
    linesByOrderId.set(line.order_id, list);
  }

  const packingOrders = (orders ?? [])
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
          };
        })
        .filter((line): line is NonNullable<typeof line> => line !== null);
      return {
        id: order.id,
        customerName: customer?.display_name ?? "Unknown customer",
        zone: customer?.zone ?? "",
        lines,
      };
    })
    .filter((order) => order.lines.length > 0);

  const substituteProducts = (products ?? []).map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="p-4 space-y-4">
      <PageHeader
        title="Packing"
        subtitle={`${packingOrders.length} order${packingOrders.length === 1 ? "" : "s"} to pack today`}
      />

      {packingOrders.length === 0 && <p className="text-neutral-500">Nothing to pack right now.</p>}

      <div className="space-y-3">
        {packingOrders.map((order, index) => (
          <motion.div
            key={order.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05, duration: 0.2 }}
          >
            <PackingOrderCard order={order} products={substituteProducts} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
