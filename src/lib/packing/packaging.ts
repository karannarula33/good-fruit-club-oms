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
