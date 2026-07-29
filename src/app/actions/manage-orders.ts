"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

async function assertUnbilled(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
): Promise<string | null> {
  const { data: bill, error } = await supabase.from("bills").select("id").eq("order_id", orderId).maybeSingle();
  if (error) return error.message;
  if (bill) return "This order has already been billed and can't be edited.";
  return null;
}

export async function deleteOrderLine(
  orderId: string,
  lineId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole(["admin"]);
  const supabase = await createClient();

  const guardError = await assertUnbilled(supabase, orderId);
  if (guardError) return { ok: false, error: guardError };

  const { error } = await supabase.from("order_lines").delete().eq("id", lineId).eq("order_id", orderId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/manage-orders");
  return { ok: true };
}

export async function deleteOrder(orderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole(["admin"]);
  const supabase = await createClient();

  const guardError = await assertUnbilled(supabase, orderId);
  if (guardError) return { ok: false, error: "This order has already been billed and can't be deleted." };

  const { error: linesError } = await supabase.from("order_lines").delete().eq("order_id", orderId);
  if (linesError) return { ok: false, error: linesError.message };

  const { error: orderError } = await supabase.from("orders").delete().eq("id", orderId);
  if (orderError) return { ok: false, error: orderError.message };

  revalidatePath("/admin/manage-orders");
  return { ok: true };
}
