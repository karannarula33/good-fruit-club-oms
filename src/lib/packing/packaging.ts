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

// Single/double-letter codes used on the printed delivery sheet (see
// src/app/api/admin/orders/delivery-sheet/route.ts) -- compact enough to
// fit "B - 2" style cells, matching the abbreviations already used on the
// paper sheet the delivery team reads today.
export const PACKAGING_CODE: Record<PackagingType, string> = {
  big_box: "B",
  medium_box: "M",
  small_box: "S",
  small_packet: "SP",
  big_packet: "BP",
  tiny_box: "T",
};

function groupPackagesByType(packages: { packagingType: PackagingType }[]): { type: PackagingType; count: number }[] {
  const counts = new Map<PackagingType, number>();
  for (const p of packages) {
    counts.set(p.packagingType, (counts.get(p.packagingType) ?? 0) + 1);
  }
  return PACKAGING_TYPES.filter((t) => counts.has(t.value)).map((t) => ({ type: t.value, count: counts.get(t.value)! }));
}

// Renders "B - 1, SP - 2" style text for the printed delivery sheet.
export function summarizePackagingCodes(packages: { packagingType: PackagingType }[]): string {
  return groupPackagesByType(packages)
    .map(({ type, count }) => `${PACKAGING_CODE[type]} - ${count}`)
    .join(", ");
}

// Maps each order to the distinct packages it actually used, given the
// order's lines (for package_id) and the order_packages rows for those
// orders. Shared by every order-listing screen (Manage Orders, Dispatch,
// Delivery, the delivery sheet PDF) so they stay in sync on how a "used
// package" is determined -- a line whose package_id points at a package
// that exists in `packages`.
export function packagesUsedByOrder(
  orderLines: { order_id: string; package_id: string | null }[],
  packages: { id: string; order_id: string; packaging_type: PackagingType }[],
): Map<string, { packagingType: PackagingType }[]> {
  const packagingTypeByPackageId = new Map(packages.map((p) => [p.id, p.packaging_type]));
  const usedPackageIdsByOrderId = new Map<string, Set<string>>();
  for (const line of orderLines) {
    if (!line.package_id) continue;
    const set = usedPackageIdsByOrderId.get(line.order_id) ?? new Set<string>();
    set.add(line.package_id);
    usedPackageIdsByOrderId.set(line.order_id, set);
  }
  const usedByOrderId = new Map<string, { packagingType: PackagingType }[]>();
  for (const [orderId, packageIds] of usedPackageIdsByOrderId) {
    const used = [...packageIds]
      .map((id) => packagingTypeByPackageId.get(id))
      .filter((t): t is PackagingType => t !== undefined)
      .map((packagingType) => ({ packagingType }));
    usedByOrderId.set(orderId, used);
  }
  return usedByOrderId;
}

// Maps each order to its packaging summary text -- see packagesUsedByOrder.
export function summarizePackagingByOrder(
  orderLines: { order_id: string; package_id: string | null }[],
  packages: { id: string; order_id: string; packaging_type: PackagingType }[],
): Map<string, string> {
  const summaryByOrderId = new Map<string, string>();
  for (const [orderId, used] of packagesUsedByOrder(orderLines, packages)) {
    summaryByOrderId.set(orderId, summarizePackaging(used));
  }
  return summaryByOrderId;
}

// Groups packages by type and renders "1 Big Box, 2 Small Packets" style
// text -- shared by the admin packed-order view and the delivery stop card.
export function summarizePackaging(packages: { packagingType: PackagingType }[]): string {
  if (packages.length === 0) return "";
  return groupPackagesByType(packages)
    .map(({ type, count }) => {
      const label = PACKAGING_LABEL[type];
      const plural = count === 1 ? label : label.endsWith("x") ? `${label}es` : `${label}s`;
      return `${count} ${plural}`;
    })
    .join(", ");
}
