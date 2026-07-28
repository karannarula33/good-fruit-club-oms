"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";

// CLAUDE.md §3.5: "dispatched ... flipped as a batch action ('dispatch
// today's packed orders')". Sequential read-modify-write per order (not a
// raw SQL jsonb merge) -- same style as finalizeOrder/markListSent.
export async function dispatchPackedOrders(): Promise<
  { ok: true; count: number } | { ok: false; error: string }
> {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const today = utcToIstDatetimeLocal(new Date()).slice(0, 10);

  const { data: orders, error: loadError } = await supabase
    .from("orders")
    .select("id, status_timestamps")
    .eq("delivery_date", today)
    .eq("status", "packed");
  if (loadError) {
    return { ok: false, error: loadError.message };
  }
  if (!orders || orders.length === 0) {
    return { ok: true, count: 0 };
  }

  const now = new Date().toISOString();
  for (const order of orders) {
    const mergedStatusTimestamps = {
      ...(order.status_timestamps as Record<string, string>),
      dispatched: now,
    };
    const { error } = await supabase
      .from("orders")
      .update({ status: "dispatched", status_timestamps: mergedStatusTimestamps })
      .eq("id", order.id);
    if (error) {
      return { ok: false, error: error.message };
    }
  }

  revalidatePath("/status");
  return { ok: true, count: orders.length };
}
