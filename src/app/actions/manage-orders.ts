"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { loadPriceItemRecords, loadPriceTierRecords } from "@/lib/pricing/load";
import { resolveTieredPriceForProduct } from "@/lib/pricing/resolve";
import { resolveQtyUpdateField, buildNewOrderLineRow, isOrderStatusEditable } from "@/lib/orders/edit-order";
import { ORDER_STATUS_LABEL } from "@/lib/orders/status-display";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { duplicateLineRows } from "@/lib/orders/duplicate";
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

// A second, identical order for the same customer on the same delivery date
// (admin, 2026-11-11: e.g. a second box), kept separate from the original.
// Copies what was ordered (src/lib/orders/duplicate.ts) as a new "To pack"
// order; packing, billing, discounts and payments are its own. Later pastes
// for that customer and day still merge into the original (the earliest
// open order).
export async function duplicateOrder(orderId: string): Promise<{ ok: true; orderId: string } | { ok: false; error: string }> {
  const profile = await requireRole(["admin"]);
  // Service role: the copy is made in one go even when the original is
  // already packed or billed, after the admin check above.
  const supabase = createServiceRoleClient();
  const { data: source } = await supabase
    .from("orders")
    .select("id, customer_id, placed_at, delivery_date, raw_paste, notes, channel")
    .eq("id", orderId)
    .maybeSingle();
  if (!source) return { ok: false, error: "Order not found." };
  const { data: lines, error: linesError } = await supabase
    .from("order_lines")
    .select("product_id, ordered_qty, ordered_unit, locked_price_per_unit, is_gift_box, is_substitution, parse_confidence")
    .eq("order_id", orderId);
  if (linesError) return { ok: false, error: linesError.message };

  const { data: copy, error: orderError } = await supabase
    .from("orders")
    .insert({
      customer_id: source.customer_id,
      placed_at: source.placed_at,
      delivery_date: source.delivery_date,
      status: "recorded",
      raw_paste: source.raw_paste,
      notes: source.notes,
      channel: source.channel,
      created_by: profile.id,
      duplicated_from: source.id,
    })
    .select("id")
    .single();
  if (orderError || !copy) return { ok: false, error: orderError?.message ?? "Could not create the copy." };

  const rows = duplicateLineRows(copy.id, lines ?? []);
  if (rows.length === 0) {
    await supabase.from("orders").delete().eq("id", copy.id);
    return { ok: false, error: "This order has no items to copy." };
  }
  const { error: insertError } = await supabase.from("order_lines").insert(rows);
  if (insertError) {
    await supabase.from("orders").delete().eq("id", copy.id);
    return { ok: false, error: insertError.message };
  }

  revalidatePath("/admin/manage-orders");
  revalidatePath("/packer");
  return { ok: true, orderId: copy.id };
}
