import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { compareByZone, type Zone } from "@/lib/customers/zone";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBoardRealtime } from "./status-board-realtime";

export default async function StatusBoardPage() {
  const profile = await requireRole(["admin", "packer", "delivery"]);

  const supabase = await createClient();
  const today = utcToIstDatetimeLocal(new Date()).slice(0, 10);

  const { data: orders } = await supabase
    .from("orders")
    .select("id, status, status_timestamps, customer_id, customers(display_name, zone)")
    .eq("delivery_date", today)
    .neq("status", "cancelled");

  const rows = (orders ?? [])
    .map((order) => {
      const customer = order.customers as unknown as { display_name: string; zone: Zone } | null;
      return {
        id: order.id,
        customerName: customer?.display_name ?? "Unknown customer",
        zone: customer?.zone ?? ("Unassigned" as Zone),
        status: order.status,
        statusTimestamps: order.status_timestamps as Record<string, string>,
      };
    })
    .sort((a, b) => compareByZone(a.zone, b.zone) || a.customerName.localeCompare(b.customerName));

  return (
    <div className="p-4 space-y-4">
      <PageHeader title="Status board" subtitle="Today's orders, live" />
      <StatusBoardRealtime initialOrders={rows} today={today} isAdmin={profile.role === "admin"} />
    </div>
  );
}
