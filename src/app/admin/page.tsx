import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";

export default async function AdminPage() {
  const profile = await requireRole(["admin"]);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Admin</h1>
      <p className="text-neutral-600">
        Welcome, {profile.full_name || profile.phone}. Procurement, the full
        Customer Ledger, and the Status board land in later slices.
      </p>
      <div className="flex gap-4">
        <Link href="/admin/orders" className="text-sm underline text-neutral-900">
          Order Entry
        </Link>
        <Link href="/admin/prices" className="text-sm underline text-neutral-900">
          Prices
        </Link>
        <Link href="/admin/customers" className="text-sm underline text-neutral-900">
          Customers
        </Link>
      </div>
    </div>
  );
}
