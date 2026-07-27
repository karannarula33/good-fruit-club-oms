"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export async function markListSent(
  deliveryDate: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await requireRole(["admin"]);

  const supabase = await createClient();
  const { error } = await supabase.from("procurement_marks").insert({
    delivery_date: deliveryDate,
    list_sent_at: new Date().toISOString(),
    sent_by: profile.id,
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Already marked sent for this delivery date." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/procurement");
  return { ok: true };
}
