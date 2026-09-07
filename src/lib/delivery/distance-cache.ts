// Daily order -> Google Sheets sync: looks up (or computes + caches) a
// customer's driving distance from the Gurgaon hub. Backed by
// customer_hub_distances (0025_customer_hub_distances.sql) so a repeat
// customer's address isn't re-geocoded -- and re-billed by Google -- on
// every run; only recomputed when customers.address no longer matches the
// cached address_snapshot.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export async function resolveCustomerDistanceKm(
  supabase: Client,
  customer: { id: string; address: string },
  hubOrigin: string,
  getDrivingDistanceKm: (origin: string, destination: string) => Promise<number | null>,
): Promise<number | null> {
  const { data: cached, error: cacheError } = await supabase
    .from("customer_hub_distances")
    .select("distance_km, address_snapshot")
    .eq("customer_id", customer.id)
    .maybeSingle();
  if (cacheError) {
    throw new Error(`Failed to load customer_hub_distances for ${customer.id}: ${cacheError.message}`);
  }

  if (cached && cached.address_snapshot === customer.address) {
    return cached.distance_km;
  }

  const distanceKm = await getDrivingDistanceKm(hubOrigin, customer.address);
  if (distanceKm === null) return null;

  const { error: upsertError } = await supabase.from("customer_hub_distances").upsert(
    {
      customer_id: customer.id,
      address_snapshot: customer.address,
      distance_km: distanceKm,
      computed_at: new Date().toISOString(),
    },
    { onConflict: "customer_id" },
  );
  if (upsertError) {
    throw new Error(`Failed to cache distance for customer ${customer.id}: ${upsertError.message}`);
  }

  return distanceKm;
}
