"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

// Packer (or admin) records end-of-day leftover stock for a date. Batched, like
// markProcurementItemsSent -- one explicit "Save" rather than per-field writes.
// Only products with a positive leftover are kept; a product cleared to 0/blank
// has its row for that date removed, so "absent = none left" stays true and the
// table holds only real leftovers (migration 0030).
export async function recordStockCount(
  asOfDate: string,
  items: { productId: string; qty: number }[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await requireRole(["admin", "packer"]);
  const supabase = await createClient();

  const toUpsert = items.filter((i) => Number.isFinite(i.qty) && i.qty > 0);
  const toDelete = items.filter((i) => !(Number.isFinite(i.qty) && i.qty > 0)).map((i) => i.productId);

  if (toUpsert.length > 0) {
    const { error } = await supabase.from("inventory_snapshots").upsert(
      toUpsert.map((i) => ({
        as_of_date: asOfDate,
        product_id: i.productId,
        qty: i.qty,
        recorded_by: profile.id,
        recorded_at: new Date().toISOString(),
      })),
      { onConflict: "as_of_date,product_id" },
    );
    if (error) return { ok: false, error: error.message };
  }

  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("inventory_snapshots")
      .delete()
      .eq("as_of_date", asOfDate)
      .in("product_id", toDelete);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/packer/stock");
  revalidatePath("/admin/procurement");
  return { ok: true };
}
