"use server";

// Item changes on a packed, not-yet-billed order at the billing step, for the
// admin and for a packer with billing access (admin, 2026-10-17: Kunal may
// edit items and quantities while generating a bill -- never prices). Qty
// corrections go through overrideLineQuantity (src/app/actions/bills.ts);
// this file removes and adds items. Both roles have RLS insert/update on
// order_lines, so the signed-in client is used.

import { revalidatePath } from "next/cache";
import { requireBillingAccess } from "@/lib/auth/billing-access";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

async function packedUnbilledOrder(supabase: Awaited<ReturnType<typeof createClient>>, orderId: string): Promise<Result> {
  const { data: order } = await supabase.from("orders").select("status").eq("id", orderId).single();
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status !== "packed") return { ok: false, error: "Only a packed order can be changed here." };
  const { data: bill } = await supabase.from("bills").select("id").eq("order_id", orderId).maybeSingle();
  if (bill) return { ok: false, error: "This order is already billed — ask the admin to edit the bill." };
  return { ok: true };
}

// Marks the item unavailable: kept for the record, left off the bill.
export async function removePackedLine(orderId: string, lineId: string): Promise<Result> {
  await requireBillingAccess();
  const supabase = await createClient();
  const guard = await packedUnbilledOrder(supabase, orderId);
  if (!guard.ok) return guard;
  const { data: lines } = await supabase.from("order_lines").select("id, line_status").eq("order_id", orderId);
  const stillPacked = (lines ?? []).filter((l) => l.line_status === "packed" && l.id !== lineId);
  if (stillPacked.length === 0) return { ok: false, error: "That's the last item on the order — it can't be removed here." };
  const { error } = await supabase
    .from("order_lines")
    .update({ line_status: "unavailable" })
    .eq("id", lineId)
    .eq("order_id", orderId)
    .eq("line_status", "packed");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/packer");
  return { ok: true };
}

// The new item is priced at billing from the price list, like every other
// line on a pasted order.
export async function addPackedLine(orderId: string, productId: string, qty: number): Promise<Result> {
  const { profile } = await requireBillingAccess();
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "Enter a quantity greater than zero." };
  const supabase = await createClient();
  const guard = await packedUnbilledOrder(supabase, orderId);
  if (!guard.ok) return guard;
  const { data: product } = await supabase.from("products").select("unit_label").eq("id", productId).single();
  if (!product) return { ok: false, error: "Product not found." };
  const { error } = await supabase.from("order_lines").insert({
    order_id: orderId,
    product_id: productId,
    ordered_qty: qty,
    ordered_unit: product.unit_label,
    actual_qty: qty,
    locked_price_per_unit: null,
    line_status: "packed",
    parse_confidence: "clean",
    parse_note: `Added at billing by ${profile.full_name ?? "staff"}`,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/packer");
  return { ok: true };
}
