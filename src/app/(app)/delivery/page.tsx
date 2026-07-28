import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { compareByZone, type Zone } from "@/lib/customers/zone";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { DeliveryStopsBoard } from "./delivery-stops-board";
import type { OrderStatus } from "@/lib/supabase/database.types";

export default async function DeliveryPage() {
  await requireRole(["delivery", "admin"]);

  const supabase = await createClient();
  const today = utcToIstDatetimeLocal(new Date()).slice(0, 10);

  const { data: orders } = await supabase
    .from("orders")
    .select("id, status, customer_id, customers(display_name, phone, address, zone)")
    .eq("delivery_date", today)
    .in("status", ["dispatched", "out_for_delivery", "delivered"]);

  const orderIds = (orders ?? []).map((o) => o.id);
  const { data: bills } = orderIds.length
    ? await supabase.from("bills").select("order_id, total, net_due").in("order_id", orderIds)
    : { data: [] };
  const billByOrderId = new Map((bills ?? []).map((b) => [b.order_id, b]));

  const stops = (orders ?? [])
    .map((order) => {
      const customer = order.customers as unknown as {
        display_name: string;
        phone: string | null;
        address: string;
        zone: Zone;
      } | null;
      const bill = billByOrderId.get(order.id);
      return {
        id: order.id,
        status: order.status as OrderStatus,
        customerName: customer?.display_name ?? "Unknown customer",
        phone: customer?.phone ?? null,
        address: customer?.address ?? "",
        zone: customer?.zone ?? ("Unassigned" as Zone),
        billTotal: bill?.total ?? null,
        netDue: bill?.net_due ?? null,
      };
    })
    .sort((a, b) => compareByZone(a.zone, b.zone) || a.customerName.localeCompare(b.customerName));

  return (
    <div className="p-4 space-y-4">
      <PageHeader title="Delivery route" subtitle={`${stops.length} stop${stops.length === 1 ? "" : "s"} today`} />
      <DeliveryStopsBoard stops={stops} />
    </div>
  );
}
