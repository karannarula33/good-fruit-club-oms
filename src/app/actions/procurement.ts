"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export async function toggleProcurementItemCheck(
  deliveryDate: string,
  productId: string,
  checked: boolean,
  currentQty: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await requireRole(["admin"]);

  const supabase = await createClient();

  if (checked) {
    const { error } = await supabase.from("procurement_item_checks").upsert(
      {
        delivery_date: deliveryDate,
        product_id: productId,
        checked_qty: currentQty,
        checked_by: profile.id,
        checked_at: new Date().toISOString(),
      },
      { onConflict: "delivery_date,product_id" },
    );
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from("procurement_item_checks")
      .delete()
      .eq("delivery_date", deliveryDate)
      .eq("product_id", productId);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/admin/procurement");
  return { ok: true };
}
