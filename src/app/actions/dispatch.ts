"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";

// CLAUDE.md §3.5: "dispatched ... flipped as a batch action ('dispatch
// today's packed orders')" -- scoped to whichever orders the admin has
// selected on the status board, not automatically every packed order.
// Read-modify-write per order (not a raw SQL jsonb merge), but the writes
// themselves run in parallel (Promise.all) since each order is an
// independent row -- N sequential round trips would otherwise dominate
// perceived latency for a multi-order dispatch. Re-filtering by
// delivery_date/status server-side (rather than trusting the selection
// as-is) guards against a stale selection racing another dispatch.
export async function dispatchPackedOrders(
  orderIds: string[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  await requireRole(["admin"]);
  if (orderIds.length === 0) {
    return { ok: true, count: 0 };
  }
  const supabase = await createClient();
  const today = utcToIstDatetimeLocal(new Date()).slice(0, 10);

  const { data: orders, error: loadError } = await supabase
    .from("orders")
    .select("id, status_timestamps")
    .eq("delivery_date", today)
    .eq("status", "packed")
    .in("id", orderIds);
  if (loadError) {
    return { ok: false, error: loadError.message };
  }
  if (!orders || orders.length === 0) {
    return { ok: true, count: 0 };
  }

  const now = new Date().toISOString();
  const results = await Promise.all(
    orders.map((order) => {
      const mergedStatusTimestamps = {
        ...(order.status_timestamps as Record<string, string>),
        dispatched: now,
      };
      return supabase
        .from("orders")
        .update({ status: "dispatched", status_timestamps: mergedStatusTimestamps })
        .eq("id", order.id);
    }),
  );
  const firstError = results.find((r) => r.error);
  if (firstError?.error) {
    return { ok: false, error: firstError.error.message };
  }

  revalidatePath("/status");
  return { ok: true, count: orders.length };
}
