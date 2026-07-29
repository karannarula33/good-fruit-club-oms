import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { OrderPasteReview } from "./order-paste-review";

export default async function AdminOrdersPage() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const [{ data: customers }, { data: products }] = await Promise.all([
    supabase.from("customers").select("id, display_name, phone").order("display_name"),
    supabase.from("products").select("id, name").eq("active", true).order("name"),
  ]);

  return (
    <div className="flex flex-col gap-4 px-[18px] pt-5">
      <PageHeader title="Order Entry" subtitle="Paste the customer's WhatsApp message" />

      <OrderPasteReview
        customers={(customers ?? []).map((c) => ({ id: c.id, name: c.display_name, phone: c.phone }))}
        products={(products ?? []).map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  );
}
