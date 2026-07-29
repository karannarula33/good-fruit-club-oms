import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { zonePriority } from "@/lib/customers/zone";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ZoneSelect } from "./zone-select";

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
    <div className="p-6 space-y-4">
      <PageHeader
        title="Customers"
        subtitle={
          <>
            {sorted.length} customers
            {unassignedCount > 0 && (
              <span className="text-danger-text"> · {unassignedCount} need a zone assigned</span>
            )}
          </>
        }
      />

      <Table>
        <THead>
          <TR>
            <TH>Name</TH>
            <TH>Phone</TH>
            <TH>Address</TH>
            <TH>Zone</TH>
            <TH>Notes</TH>
          </TR>
        </THead>
        <TBody>
          {sorted.map((customer) => (
            <TR key={customer.id} className="align-top">
              <TD>
                <Link href={`/admin/customers/${customer.id}`} className="underline">
                  {customer.display_name}
                </Link>
              </TD>
              <TD className="text-neutral-600 dark:text-neutral-400">{customer.phone ?? "—"}</TD>
              <TD className="text-neutral-600 dark:text-neutral-400 max-w-sm">{customer.address}</TD>
              <TD>
                <ZoneSelect customerId={customer.id} zone={customer.zone} />
              </TD>
              <TD className="text-neutral-600 dark:text-neutral-400 max-w-xs">{customer.notes ?? "—"}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
