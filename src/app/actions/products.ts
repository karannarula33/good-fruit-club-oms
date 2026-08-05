"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export interface CreateProductInput {
  name: string;
  unitType: "weight" | "count";
  unitLabel: string;
}

export async function createProduct(
  input: CreateProductInput,
): Promise<{ ok: true; product: { id: string; name: string } } | { ok: false; error: string }> {
  await requireRole(["admin"]);

  const name = input.name.trim();
  const unitLabel = input.unitLabel.trim();
  if (!name) {
    return { ok: false, error: "Product name is required." };
  }
  if (!unitLabel) {
    return { ok: false, error: "Unit label is required." };
  }
  if (input.unitType !== "weight" && input.unitType !== "count") {
    return { ok: false, error: "Unit type must be weight or count." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .insert({ name, unit_type: input.unitType, unit_label: unitLabel, active: true })
    .select("id, name")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to create product." };
  }

  revalidatePath("/admin/orders");
  return { ok: true, product: { id: data.id, name: data.name } };
}
