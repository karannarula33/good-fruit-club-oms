import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { compareByZone, type Zone } from "@/lib/customers/zone";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { DateNav } from "@/components/ui/date-nav";
import { DispatchBoard } from "./dispatch-board";
import { summarizePackagingByOrder } from "@/lib/packing/packaging";
import type { PackagingType } from "@/lib/supabase/database.types";

// First mile: packed + billed orders waiting to leave Paschim Vihar for
// Gurgaon. Admin-only -- split out of what used to be the top of the
// delivery ("Route") screen so that screen is last-mile only.
export default async function DispatchPage({
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
    .select("id, customer_id, customers(display_name, zone)")
    .eq("delivery_date", date)
    .eq("status", "packed");

  const orderIds = (orders ?? []).map((o) => o.id);
  const [{ data: bills }, { data: orderLines }, { data: packages }] = await Promise.all([
    orderIds.length
      ? supabase.from("bills").select("order_id, net_due").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? supabase.from("order_lines").select("order_id, package_id").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? supabase.from("order_packages").select("id, order_id, packaging_type").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
  ]);
  const netDueByOrderId = new Map((bills ?? []).map((b) => [b.order_id, b.net_due]));
  const packagingSummaryByOrderId = summarizePackagingByOrder(
    orderLines ?? [],
    (packages ?? []).map((p) => ({ id: p.id, order_id: p.order_id, packaging_type: p.packaging_type as PackagingType })),
  );

  const readyToDispatch = (orders ?? [])
    .filter((order) => netDueByOrderId.has(order.id))
    .map((order) => {
      const customer = order.customers as unknown as { display_name: string; zone: Zone } | null;
      return {
        id: order.id,
        customerName: customer?.display_name ?? "Unknown customer",
        zone: customer?.zone ?? ("Unassigned" as Zone),
        netDue: netDueByOrderId.get(order.id) ?? 0,
        packagingSummary: packagingSummaryByOrderId.get(order.id) || null,
      };
    })
    .sort((a, b) => compareByZone(a.zone, b.zone) || a.customerName.localeCompare(b.customerName));

  return (
    <div className="px-[18px] pt-5 pb-4">
      <PageHeader
        title="Dispatch"
        subtitle={`${readyToDispatch.length} order${readyToDispatch.length === 1 ? "" : "s"} ready to leave`}
        action={<DateNav date={date} basePath="/admin/dispatch" />}
      />
      <div className="mt-4">
        <DispatchBoard key={date} orders={readyToDispatch} />
      </div>
    </div>
  );
}
