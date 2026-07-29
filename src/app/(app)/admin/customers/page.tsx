import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { zonePriority } from "@/lib/customers/zone";
import { PageHeader } from "@/components/ui/page-header";
import { CustomerList } from "./customer-list";

export default async function AdminCustomersPage() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const { data: customers } = await supabase
    .from("customers")
    .select("id, display_name, phone, address, zone, notes")
    .order("display_name");

  // Triage-first: customers still needing a zone assignment surface at the
  // top, ahead of already-zoned customers in their normal route order.
  const sorted = [...(customers ?? [])].sort((a, b) => {
    if (a.zone === "Unassigned" && b.zone !== "Unassigned") return -1;
    if (a.zone !== "Unassigned" && b.zone === "Unassigned") return 1;
    return zonePriority(a.zone) - zonePriority(b.zone);
  });

  const unassignedCount = sorted.filter((c) => c.zone === "Unassigned").length;

  return (
    <div className="flex flex-col gap-4 px-[18px] pt-5 pb-6">
      <PageHeader
        title="Customer Ledger"
        subtitle={
          <>
            {sorted.length} customers
            {unassignedCount > 0 && (
              <span className="text-danger-text"> · {unassignedCount} need a zone assigned</span>
            )}
          </>
        }
      />
      <CustomerList customers={sorted} />
    </div>
  );
}
