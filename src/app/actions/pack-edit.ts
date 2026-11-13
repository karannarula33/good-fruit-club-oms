"use server";

// Changes to an order that's still to be packed, from the packing screen
// (admin, 2026-11-07: packers Kunal and Ravi, and the admin). Change an
// item's quantity, remove an item, add an item, or cancel the order with a
// reason. Never prices: a new item's price is locked from the price list
// here on the server (packers can't read prices), exactly as Manage Orders
// does. Rules: src/lib/orders/pack-edit.ts. Hard-deleting an order stays
// admin-only (Manage Orders).

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadPriceItemRecords, loadPriceTierRecords } from "@/lib/pricing/load";
import { resolveTieredPriceForProduct } from "@/lib/pricing/resolve";
import { cleanCancelReason, lineEditGuard, removeLineGuard, toPackGuard, validQty } from "@/lib/orders/pack-edit";

type Result = { ok: true } | { ok: false; error: string };
type Client = ReturnType<typeof createServiceRoleClient>;

async function loadToPackOrder(db: Client, orderId: string) {
  const { data: order } = await db.from("orders").select("id, status, status_timestamps").eq("id", orderId).maybeSingle();
  if (!order) return { ok: false as const, error: "Order not found." };
  const { data: bill } = await db.from("bills").select("id").eq("order_id", orderId).maybeSingle();
  const guard = toPackGuard(order.status, !!bill);
  if (!guard.ok) return guard;
  return { ok: true as const, order };
}

async function getLine(db: Client, orderId: string, lineId: string) {
  const { data: line } = await db
    .from("order_lines")
    .select("id, line_status")
    .eq("id", lineId)
    .eq("order_id", orderId)
    .maybeSingle();
  if (!line) return { ok: false as const, error: "Item not found." };
  const guard = lineEditGuard(line.line_status);
  if (!guard.ok) return guard;
  return { ok: true as const, line };
}

function done(): Result {
  revalidatePath("/packer");
  revalidatePath("/admin/manage-orders");
  return { ok: true };
}

// Writes go through the service role after the checks above: packers have
// no delete rights on order_lines and can't read prices.
export async function updateToPackLineQty(orderId: string, lineId: string, qty: number): Promise<Result> {
  await requireRole(["packer", "admin", "engagement"]);
  if (!validQty(qty)) return { ok: false, error: "Enter a quantity greater than zero." };
  const db = createServiceRoleClient();
  const o = await loadToPackOrder(db, orderId);
  if (!o.ok) return o;
  const l = await getLine(db, orderId, lineId);
  if (!l.ok) return l;
  const { error } = await db.from("order_lines").update({ ordered_qty: qty }).eq("id", lineId).eq("order_id", orderId);
  if (error) return { ok: false, error: error.message };
  return done();
}

export async function removeToPackLine(orderId: string, lineId: string): Promise<Result> {
  await requireRole(["packer", "admin", "engagement"]);
  const db = createServiceRoleClient();
  const o = await loadToPackOrder(db, orderId);
  if (!o.ok) return o;
  const l = await getLine(db, orderId, lineId);
  if (!l.ok) return l;
  const { count } = await db
    .from("order_lines")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .neq("id", lineId);
  const guard = removeLineGuard(count ?? 0);
  if (!guard.ok) return guard;
  const { error } = await db.from("order_lines").delete().eq("id", lineId).eq("order_id", orderId).eq("line_status", "pending");
  if (error) return { ok: false, error: error.message };
  return done();
}

export async function addToPackLine(orderId: string, productId: string, qty: number): Promise<Result> {
  const profile = await requireRole(["packer", "admin", "engagement"]);
  if (!productId) return { ok: false, error: "Pick an item." };
  if (!validQty(qty)) return { ok: false, error: "Enter a quantity greater than zero." };
  const db = createServiceRoleClient();
  const o = await loadToPackOrder(db, orderId);
  if (!o.ok) return o;
  const { data: product } = await db.from("products").select("id, unit_label, active").eq("id", productId).maybeSingle();
  if (!product || !product.active) return { ok: false, error: "Product not found." };
  const [priceItems, tierItems] = await Promise.all([loadPriceItemRecords(db), loadPriceTierRecords(db)]);
  const locked = resolveTieredPriceForProduct(priceItems, tierItems, productId, new Date(), qty)?.pricePerUnit ?? null;
  const { error } = await db.from("order_lines").insert({
    order_id: orderId,
    product_id: productId,
    ordered_qty: qty,
    ordered_unit: product.unit_label,
    locked_price_per_unit: locked,
    line_status: "pending",
    parse_confidence: locked === null ? "flagged" : "clean",
    parse_note: `Added at packing by ${profile.full_name ?? "staff"}${locked === null ? " — no price on the list yet" : ""}`,
  });
  if (error) return { ok: false, error: error.message };
  return done();
}

export async function cancelToPackOrder(orderId: string, reason: string): Promise<Result> {
  const profile = await requireRole(["packer", "admin", "engagement"]);
  const r = cleanCancelReason(reason);
  if (!r.ok) return r;
  const db = createServiceRoleClient();
  const o = await loadToPackOrder(db, orderId);
  if (!o.ok) return o;
  const now = new Date().toISOString();
  const timestamps = { ...((o.order.status_timestamps as Record<string, string>) ?? {}), cancelled: now };
  const { error } = await db
    .from("orders")
    .update({ status: "cancelled", status_timestamps: timestamps, cancel_reason: r.reason, cancelled_by: profile.id })
    .eq("id", orderId)
    .eq("status", "recorded");
  if (error) return { ok: false, error: error.message };
  return done();
}
