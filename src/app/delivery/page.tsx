import { requireRole } from "@/lib/auth/require-role";

export default async function DeliveryPage() {
  const profile = await requireRole(["delivery", "admin"]);

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Delivery route</h1>
      <p className="text-neutral-600">
        Welcome, {profile.full_name || profile.phone}. The route view lands
        in a later slice.
      </p>
    </div>
  );
}
