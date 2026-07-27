import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { OrderPasteReview } from "./order-paste-review";

export default async function AdminOrdersPage() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const [{ data: customers }, { data: products }] = await Promise.all([
    supabase.from("customers").select("id, display_name, phone").order("display_name"),
    supabase.from("products").select("id, name").eq("active", true).order("name"),
  ]);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Order Entry</h1>
        <p className="text-neutral-600">Paste a customer&apos;s WhatsApp order to parse, review, and save it.</p>
      </div>

      <OrderPasteReview
        customers={(customers ?? []).map((c) => ({ id: c.id, name: c.display_name, phone: c.phone }))}
        products={(products ?? []).map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  );
}
