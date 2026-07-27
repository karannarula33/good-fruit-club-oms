"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { ZONE_ORDER } from "@/lib/customers/zone";
import type { CustomerZone } from "@/lib/supabase/database.types";

const VALID_ZONES: readonly string[] = [...ZONE_ORDER, "Unassigned"];

export async function updateCustomerZone(
  customerId: string,
  zone: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole(["admin"]);

  if (!VALID_ZONES.includes(zone)) {
    return { ok: false, error: `Unknown zone: ${zone}` };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ zone: zone as CustomerZone })
    .eq("id", customerId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/customers");
  return { ok: true };
}
