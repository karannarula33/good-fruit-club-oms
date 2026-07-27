import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { zonePriority } from "@/lib/customers/zone";
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
      <div>
        <h1 className="text-xl font-semibold">Customers</h1>
        <p className="text-neutral-600">
          {sorted.length} customers
          {unassignedCount > 0 && (
            <span className="text-red-600"> · {unassignedCount} need a zone assigned</span>
          )}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-neutral-300 rounded-md">
          <thead>
            <tr className="bg-neutral-100 text-left">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Address</th>
              <th className="px-3 py-2">Zone</th>
              <th className="px-3 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((customer) => (
              <tr key={customer.id} className="border-t border-neutral-200 align-top">
                <td className="px-3 py-2">{customer.display_name}</td>
                <td className="px-3 py-2 text-neutral-600">{customer.phone ?? "—"}</td>
                <td className="px-3 py-2 text-neutral-600 max-w-sm">{customer.address}</td>
                <td className="px-3 py-2">
                  <ZoneSelect customerId={customer.id} zone={customer.zone} />
                </td>
                <td className="px-3 py-2 text-neutral-600 max-w-xs">{customer.notes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
