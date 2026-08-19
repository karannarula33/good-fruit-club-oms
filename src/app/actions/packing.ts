"use server";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { loadPriceItemRecords, loadPriceTierRecords } from "@/lib/pricing/load";
import {
  buildFinalizeOrderPlan,
  type PackingLineResolution,
  type SubstitutionInput,
} from "@/lib/packing/finalize";

export async function finalizeOrder(
  orderId: string,
  resolutions: PackingLineResolution[],
  substitutions: SubstitutionInput[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole(["packer", "admin"]);

  const supabase = await createClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("status, status_timestamps, placed_at")
    .eq("id", orderId)
    .single();
  if (orderError || !order) {
    return { ok: false, error: orderError?.message ?? "Order not found." };
  }
  if (order.status !== "recorded") {
    return { ok: false, error: `Order is already ${order.status}.` };
  }

  const { data: existingLines, error: linesError } = await supabase
    .from("order_lines")
    .select("id, product_id")
    .eq("order_id", orderId);
  if (linesError) {
    return { ok: false, error: linesError.message };
  }

  const resolvedLineIds = new Set(resolutions.map((r) => r.lineId));
  const missing = (existingLines ?? []).filter((line) => !resolvedLineIds.has(line.id));
  if (missing.length > 0) {
    return { ok: false, error: `${missing.length} line(s) still need to be packed or marked unavailable.` };
  }
  for (const resolution of resolutions) {
    if (resolution.resolution === "packed" && (!Number.isFinite(resolution.actualQty) || (resolution.actualQty ?? 0) <= 0)) {
      return { ok: false, error: "Every packed line needs a quantity greater than zero." };
    }
  }

  const productIdByLineId = new Map(
    (existingLines ?? []).filter((line) => line.product_id).map((line) => [line.id, line.product_id as string]),
  );

  const [priceItems, tierItems] = await Promise.all([loadPriceItemRecords(supabase), loadPriceTierRecords(supabase)]);
  const now = new Date();
  const plan = buildFinalizeOrderPlan({
    resolutions,
    substitutions,
    priceItems,
    tierItems,
    productIdByLineId,
    placedAt: new Date(order.placed_at),
    now,
  });

  // Each line is an independent row -- run the writes in parallel rather
  // than one sequential round trip per line.
  const lineUpdateResults = await Promise.all(
    plan.lineUpdates.map((update) =>
      supabase
        .from("order_lines")
        .update({
          line_status: update.lineStatus,
          actual_qty: update.actualQty,
          locked_price_per_unit: update.lockedPricePerUnit,
        })
        .eq("id", update.lineId),
    ),
  );
  const firstLineUpdateError = lineUpdateResults.find((r) => r.error);
  if (firstLineUpdateError?.error) {
    return { ok: false, error: firstLineUpdateError.error.message };
  }

  if (plan.newSubstitutionLines.length > 0) {
    const { error } = await supabase.from("order_lines").insert(
      plan.newSubstitutionLines.map((line) => ({
        order_id: orderId,
        product_id: line.productId,
        actual_qty: line.actualQty,
        locked_price_per_unit: line.lockedPricePerUnit,
        line_status: "packed" as const,
        is_substitution: true,
        substituted_for_line_id: line.substitutedForLineId,
      })),
    );
    if (error) {
      return { ok: false, error: error.message };
    }
  }

  // CLAUDE.md §3.5 allows cancelled "until packed" -- if nothing on the
  // order actually got packed (every line unavailable, no substitutes),
  // close it out as cancelled instead of leaving a ₹0 "ready to bill"
  // order in the queue for admin to notice and cancel manually.
  const finalStatus = plan.shouldCancel ? "cancelled" : "packed";
  const mergedStatusTimestamps = { ...order.status_timestamps, [finalStatus]: now.toISOString() };
  const { error: finalizeError } = await supabase
    .from("orders")
    .update({ status: finalStatus, status_timestamps: mergedStatusTimestamps })
    .eq("id", orderId);
  if (finalizeError) {
    return { ok: false, error: finalizeError.message };
  }

  // No revalidatePath here -- finalizeOrder and generateBill are now two
  // separately-triggered steps (packing-screen.tsx), and the packer's own
  // client explicitly calls router.refresh() after Pack & Close returns to
  // the queue, matching this app's established convention.
  return { ok: true };
}
