"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { loadPriceItemRecords, loadPriceTierRecords } from "@/lib/pricing/load";
import { resolveTieredPriceForProduct } from "@/lib/pricing/resolve";
import { resolveQtyUpdateField, buildNewOrderLineRow, isOrderStatusEditable } from "@/lib/orders/edit-order";
import { ORDER_STATUS_LABEL } from "@/lib/orders/status-display";
import type { OrderStatus } from "@/lib/supabase/database.types";

// Every mutation in this file goes through here first: an order can be
// edited or deleted up through "dispatched" (see isOrderStatusEditable) and
// only until it's billed. Returns the order's status so callers that need
// it (addOrderLine) don't have to re-fetch it.
async function assertEditableOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
): Promise<{ ok: true; status: OrderStatus } | { ok: false; error: string }> {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .single();
  if (orderError || !order) return { ok: false, error: orderError?.message ?? "Order not found." };

  if (!isOrderStatusEditable(order.status)) {
    return {
      ok: false,
      error: `${ORDER_STATUS_LABEL[order.status]} — can't be edited or deleted.`,
    };
  }

  const { data: bill, error: billError } = await supabase
    .from("bills")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (billError) return { ok: false, error: billError.message };
  if (bill) return { ok: false, error: "Already billed — can't be edited or deleted." };

  return { ok: true, status: order.status };
}

export async function deleteOrderLine(
  orderId: string,
  lineId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole(["admin"]);
  const supabase = await createClient();

  const guard = await assertEditableOrder(supabase, orderId);
  if (!guard.ok) return guard;

  const { error } = await supabase.from("order_lines").delete().eq("id", lineId).eq("order_id", orderId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/manage-orders");
  return { ok: true };
}

export async function updateOrderLineQty(
  orderId: string,
  lineId: string,
  qty: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole(["admin"]);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: "Enter a quantity greater than zero." };
  }

  const supabase = await createClient();

  const guard = await assertEditableOrder(supabase, orderId);
  if (!guard.ok) return guard;

  const { data: line, error: lineError } = await supabase
    .from("order_lines")
    .select("line_status")
    .eq("id", lineId)
    .eq("order_id", orderId)
    .single();
  if (lineError || !line) return { ok: false, error: lineError?.message ?? "Line not found." };

  const field = resolveQtyUpdateField(line.line_status);
  const update = field === "actual_qty" ? { actual_qty: qty } : { ordered_qty: qty };
  const { error } = await supabase.from("order_lines").update(update).eq("id", lineId).eq("order_id", orderId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/manage-orders");
  return { ok: true };
}

export async function addOrderLine(
  orderId: string,
  productId: string,
  qty: number,
  unit: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole(["admin"]);
  if (!productId) return { ok: false, error: "Pick a product." };
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: "Enter a quantity greater than zero." };
  }

  const supabase = await createClient();

  const guard = await assertEditableOrder(supabase, orderId);
  if (!guard.ok) return guard;

  const [priceItems, tierItems] = await Promise.all([
    loadPriceItemRecords(supabase),
    loadPriceTierRecords(supabase),
  ]);
  const lockedPricePerUnit =
    resolveTieredPriceForProduct(priceItems, tierItems, productId, new Date(), qty)?.pricePerUnit ?? null;

  const row = buildNewOrderLineRow({
    orderId,
    orderStatus: guard.status,
    productId,
    qty,
    unit,
    lockedPricePerUnit,
  });

  const { error } = await supabase.from("order_lines").insert(row);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/manage-orders");
  return { ok: true };
}

export async function deleteOrder(orderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole(["admin"]);
  const supabase = await createClient();

  const guard = await assertEditableOrder(supabase, orderId);
  if (!guard.ok) return guard;

  const { error: linesError } = await supabase.from("order_lines").delete().eq("order_id", orderId);
  if (linesError) return { ok: false, error: linesError.message };

  const { error: orderError } = await supabase.from("orders").delete().eq("id", orderId);
  if (orderError) return { ok: false, error: orderError.message };

  revalidatePath("/admin/manage-orders");
  return { ok: true };
}
