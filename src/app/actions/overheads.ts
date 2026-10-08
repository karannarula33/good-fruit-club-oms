"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import type { OverheadCategory } from "@/lib/supabase/database.types";

// Overheads = costs that belong to a day rather than an order (ad spend, COD
// remittance fees, Mover minimum guarantees). The dashboard subtracts them
// from contribution for "Net after overheads". Packer wages are deliberately
// not entered here: they are already on order lines as labour cost.

const CATEGORIES: OverheadCategory[] = ["ads", "day_level", "other"];

export interface AddOverheadInput {
  date: string;
  category: OverheadCategory;
  amount: number;
  note: string;
}

export async function addOverhead(input: AddOverheadInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await requireRole(["admin"]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: "Pick a date." };
  if (!CATEGORIES.includes(input.category)) return { ok: false, error: "Pick a type." };
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { ok: false, error: "Enter an amount above ₹0." };

  const supabase = await createClient();
  const { error } = await supabase.from("overhead_entries").insert({
    entry_date: input.date,
    category: input.category,
    amount: Math.round(input.amount * 100) / 100,
    note: input.note.trim() || null,
    entered_by: profile.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/overheads");
  revalidatePath("/admin/dashboard");
  return { ok: true };
}

export async function deleteOverhead(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { error } = await supabase.from("overhead_entries").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/overheads");
  revalidatePath("/admin/dashboard");
  return { ok: true };
}
