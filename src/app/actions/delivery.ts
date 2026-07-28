"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { insertCredit } from "@/lib/billing/credit";
import type { LedgerMode } from "@/lib/supabase/database.types";

// CLAUDE.md §7: "mark out_for_delivery (batch)". Same sequential
// read-modify-write pattern as dispatchPackedOrders/finalizeOrder.
export async function markOutForDelivery(): Promise<
  { ok: true; count: number } | { ok: false; error: string }
> {
  await requireRole(["delivery", "admin"]);
  const supabase = await createClient();
  const today = utcToIstDatetimeLocal(new Date()).slice(0, 10);

  const { data: orders, error: loadError } = await supabase
    .from("orders")
    .select("id, status_timestamps")
    .eq("delivery_date", today)
    .eq("status", "dispatched");
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
      out_for_delivery: now,
    };
    const { error } = await supabase
      .from("orders")
      .update({ status: "out_for_delivery", status_timestamps: mergedStatusTimestamps })
      .eq("id", order.id);
    if (error) {
      return { ok: false, error: error.message };
    }
  }

  revalidatePath("/delivery");
  revalidatePath("/status");
  return { ok: true, count: orders.length };
}

// CLAUDE.md §3.7: "marking an order delivered prompts for payment
// collected (amount + mode, skippable if 'pay later'), which posts a
// credit allocated to that order." payment === null is the skip path --
// no ledger_entries row is created at all.
export async function deliverOrder(
  orderId: string,
  payment: { amount: number; mode: LedgerMode } | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await requireRole(["delivery", "admin"]);
  const supabase = await createClient();

  const { data: order, error: loadError } = await supabase
    .from("orders")
    .select("status_timestamps, customer_id")
    .eq("id", orderId)
    .single();
  if (loadError || !order) {
    return { ok: false, error: loadError?.message ?? "Order not found." };
  }

  const mergedStatusTimestamps = {
    ...(order.status_timestamps as Record<string, string>),
    delivered: new Date().toISOString(),
  };
  const { error: updateError } = await supabase
    .from("orders")
    .update({ status: "delivered", status_timestamps: mergedStatusTimestamps })
    .eq("id", orderId);
  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  if (payment && payment.amount > 0) {
    const result = await insertCredit(supabase, {
      customerId: order.customer_id,
      amount: payment.amount,
      mode: payment.mode,
      note: "Collected on delivery",
      allocations: [{ orderId, amount: payment.amount }],
      enteredBy: profile.id,
    });
    if (!result.ok) {
      return result;
    }
  }

  revalidatePath("/delivery");
  revalidatePath("/status");
  return { ok: true };
}
