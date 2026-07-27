import { requireRole } from "@/lib/auth/require-role";

export default async function AdminPage() {
  const profile = await requireRole(["admin"]);

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Admin</h1>
      <p className="text-neutral-600">
        Welcome, {profile.full_name || profile.phone}. Order Entry, Prices,
        Procurement, Customers &amp; Ledger, and the Status board land in
        later slices.
      </p>
    </div>
  );
}
