import { requireRole } from "@/lib/auth/require-role";

export default async function PackerPage() {
  const profile = await requireRole(["packer", "admin"]);

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Packing</h1>
      <p className="text-neutral-600">
        Welcome, {profile.full_name || profile.phone}. The packing queue
        lands in a later slice.
      </p>
    </div>
  );
}
