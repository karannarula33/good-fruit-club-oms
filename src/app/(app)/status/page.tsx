import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { compareByZone, type Zone } from "@/lib/customers/zone";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBoardRealtime } from "./status-board-realtime";

export default async function StatusBoardPage() {
  await requireRole(["admin", "packer", "delivery"]);

  const supabase = await createClient();
  const today = utcToIstDatetimeLocal(new Date()).slice(0, 10);

  const { data: orders } = await supabase
    .from("orders")
    .select("id, status, status_timestamps, customer_id, customers(display_name, zone)")
    .eq("delivery_date", today)
    .neq("status", "cancelled");

  const orderIds = (orders ?? []).map((o) => o.id);
  const { data: billedRows } = orderIds.length
    ? await supabase.from("bills").select("order_id").in("order_id", orderIds)
    : { data: [] };
  const billedIds = new Set((billedRows ?? []).map((b) => b.order_id));

  const rows = (orders ?? [])
    .map((order) => {
      const customer = order.customers as unknown as { display_name: string; zone: Zone } | null;
      return {
        id: order.id,
        customerName: customer?.display_name ?? "Unknown customer",
        zone: customer?.zone ?? ("Unassigned" as Zone),
        status: order.status,
        hasBill: billedIds.has(order.id),
        statusTimestamps: order.status_timestamps as Record<string, string>,
      };
    })
    .sort((a, b) => compareByZone(a.zone, b.zone) || a.customerName.localeCompare(b.customerName));

  return (
    <div className="px-[18px] pt-5 pb-6">
      <PageHeader title="Status Board" subtitle="Live · today's orders" />
      <div className="mt-4">
        <StatusBoardRealtime initialOrders={rows} today={today} />
      </div>
    </div>
  );
}
