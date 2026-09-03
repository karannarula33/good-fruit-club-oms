import type { PackagingType } from "@/lib/supabase/database.types";

export const PACKAGING_TYPES: { value: PackagingType; label: string }[] = [
  { value: "big_box", label: "Big Box" },
  { value: "medium_box", label: "Medium Box" },
  { value: "small_box", label: "Small Box" },
  { value: "small_packet", label: "Small Packet" },
  { value: "big_packet", label: "Big Packet" },
  { value: "tiny_box", label: "Tiny Box" },
];

export const PACKAGING_LABEL: Record<PackagingType, string> = Object.fromEntries(
  PACKAGING_TYPES.map((t) => [t.value, t.label]),
) as Record<PackagingType, string>;

// Maps each order to its packaging summary text, given the order's lines
// (for package_id) and the order_packages rows for those orders. Shared by
// every order-listing screen (Manage Orders, Dispatch, Delivery) so they
// stay in sync on how a "used package" is determined -- a line whose
// package_id points at a package that exists in `packages`.
export function summarizePackagingByOrder(
  orderLines: { order_id: string; package_id: string | null }[],
  packages: { id: string; order_id: string; packaging_type: PackagingType }[],
): Map<string, string> {
  const packagingTypeByPackageId = new Map(packages.map((p) => [p.id, p.packaging_type]));
  const usedPackageIdsByOrderId = new Map<string, Set<string>>();
  for (const line of orderLines) {
    if (!line.package_id) continue;
    const set = usedPackageIdsByOrderId.get(line.order_id) ?? new Set<string>();
    set.add(line.package_id);
    usedPackageIdsByOrderId.set(line.order_id, set);
  }
  const summaryByOrderId = new Map<string, string>();
  for (const [orderId, packageIds] of usedPackageIdsByOrderId) {
    const used = [...packageIds]
      .map((id) => packagingTypeByPackageId.get(id))
      .filter((t): t is PackagingType => t !== undefined)
      .map((packagingType) => ({ packagingType }));
    summaryByOrderId.set(orderId, summarizePackaging(used));
  }
  return summaryByOrderId;
}

// Groups packages by type and renders "1 Big Box, 2 Small Packets" style
// text -- shared by the admin packed-order view and the delivery stop card.
export function summarizePackaging(packages: { packagingType: PackagingType }[]): string {
  if (packages.length === 0) return "";
  const counts = new Map<PackagingType, number>();
  for (const p of packages) {
    counts.set(p.packagingType, (counts.get(p.packagingType) ?? 0) + 1);
  }
  return PACKAGING_TYPES.filter((t) => counts.has(t.value))
    .map((t) => {
      const count = counts.get(t.value)!;
      const label = count === 1 ? t.label : t.label.endsWith("x") ? `${t.label}es` : `${t.label}s`;
      return `${count} ${label}`;
    })
    .join(", ");
}
