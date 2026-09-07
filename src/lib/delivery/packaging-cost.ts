// Daily order -> Google Sheets sync (Master Dashboard "Pkg Cost (actual)"
// column): a flat rate per physical box/packet type an order actually
// used, plus a fixed misc charge (stickers/tape) per box/packet -- see
// packaging_cost_rates / delivery_pricing_config (migrations 0023-0024).
// Pure and DB-shape-agnostic like src/lib/billing/compute.ts -- the caller
// passes in the "packages actually used" list already computed by
// packagesUsedByOrder (src/lib/packing/packaging.ts).

import type { PackagingType } from "@/lib/supabase/database.types";
import { roundToCents } from "@/lib/billing/compute";

export function computePackagingCost(
  packages: { packagingType: PackagingType }[],
  ratePerType: Record<PackagingType, number>,
  miscCostPerPackage: number,
): number {
  const total = packages.reduce((sum, pkg) => sum + (ratePerType[pkg.packagingType] ?? 0) + miscCostPerPackage, 0);
  return roundToCents(total);
}
