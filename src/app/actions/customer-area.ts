"use server";

// Admin edits to a customer's city / area / society (migration 0039). A
// manual value is kept as is and never overwritten by the automatic read;
// "Re-read from address" hands it back to the automatic read.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { canonicalArea, isCity } from "@/lib/customers/area";
import { fillCustomerAreas, nextZone } from "@/lib/customers/fill-areas";

type Result = { ok: true } | { ok: false; error: string };

export async function setCustomerArea(
  customerId: string,
  input: { city: string; area: string; locality: string },
): Promise<Result> {
  await requireRole(["admin"]);
  if (!isCity(input.city)) return { ok: false, error: "Pick a city." };
  const area = canonicalArea(input.area);
  if (!area) return { ok: false, error: "Enter the area." };
  const supabase = await createClient();
  const locality = input.locality.trim() || null;
  const { data: current } = await supabase.from("customers").select("zone, area, locality").eq("id", customerId).single();
  const zone = current ? nextZone(current, { area, locality }) : undefined;
  const { error } = await supabase
    .from("customers")
    .update({ city: input.city, area, locality, area_source: "manual", ...(zone ? { zone } : {}) })
    .eq("id", customerId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/customers");
  revalidatePath("/admin/dashboard");
  return { ok: true };
}

export async function rereadCustomerArea(customerId: string): Promise<Result> {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { error } = await supabase.from("customers").update({ area_source: null, area_resolved_for: null }).eq("id", customerId);
  if (error) return { ok: false, error: error.message };
  try {
    await fillCustomerAreas(createServiceRoleClient(), { customerIds: [customerId] });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't read the address." };
  }
  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/dashboard");
  return { ok: true };
}
