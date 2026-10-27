"use server";

// Admin correction of an order's channel (website vs WhatsApp, migration
// 0038). Reporting only -- billing, prices and the ledger don't change. Most
// orders get the right channel automatically (website ingestion, or a GFC-####
// site order number in the paste); this is for the odd one that didn't.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import type { OrderChannel } from "@/lib/supabase/database.types";

export async function setOrderChannel(orderId: string, channel: OrderChannel): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole(["admin"]);
  if (channel !== "website" && channel !== "whatsapp") return { ok: false, error: "Unknown channel." };
  const supabase = await createClient();
  const { error } = await supabase.from("orders").update({ channel }).eq("id", orderId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/manage-orders");
  revalidatePath("/admin/dashboard");
  return { ok: true };
}
