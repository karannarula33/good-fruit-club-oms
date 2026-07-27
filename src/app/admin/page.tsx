import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";

export default async function AdminPage() {
  const profile = await requireRole(["admin"]);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Admin</h1>
      <p className="text-neutral-600">
        Welcome, {profile.full_name || profile.phone}. Order Entry,
        Procurement, Customers &amp; Ledger, and the Status board land in
        later slices.
      </p>
      <Link href="/admin/prices" className="text-sm underline text-neutral-900">
        Prices
      </Link>
    </div>
  );
}
