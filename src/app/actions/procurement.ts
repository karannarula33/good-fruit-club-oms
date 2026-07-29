"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

// Batch, not per-checkbox: the checklist's checkboxes are a selection (like
// Dispatch/Mark-out-for-delivery elsewhere in the app), confirmed with one
// explicit CTA rather than auto-saving on every click. Each item snapshots
// its current total qty into checked_qty -- see src/lib/procurement/aggregate.ts
// for how that snapshot later drives the "+N new" delta badge.
export async function markProcurementItemsSent(
  deliveryDate: string,
  items: { productId: string; qty: number }[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await requireRole(["admin"]);
  if (items.length === 0) return { ok: true };

  const supabase = await createClient();
  const now = new Date().toISOString();

  const { error } = await supabase.from("procurement_item_checks").upsert(
    items.map((item) => ({
      delivery_date: deliveryDate,
      product_id: item.productId,
      checked_qty: item.qty,
      checked_by: profile.id,
      checked_at: now,
    })),
    { onConflict: "delivery_date,product_id" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/procurement");
  return { ok: true };
}
