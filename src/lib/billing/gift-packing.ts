// Gift packing is charged on the bill (admin, 2026-10-22): ₹400 for each
// gift packing used at packing (order_packages.packaging_type =
// 'gift_packing', migration 0037), shown as its own bill line and included
// in the bill total, net due and ledger debit. A gift packing counts once
// however many items went into it, and only if a packed item is in it.
import type { BillLineItem } from "@/lib/billing/message";

export const GIFT_PACKING_RATE = 400;

export function countGiftPackings(
  packedLines: { package_id: string | null }[],
  packages: { id: string; packaging_type: string }[],
): number {
  const giftIds = new Set(packages.filter((p) => p.packaging_type === "gift_packing").map((p) => p.id));
  const used = new Set(packedLines.map((l) => l.package_id).filter((id): id is string => !!id && giftIds.has(id)));
  return used.size;
}

export function giftPackingCharge(count: number): number {
  return count * GIFT_PACKING_RATE;
}

export function giftPackingBillLine(count: number): BillLineItem | null {
  if (count <= 0) return null;
  return { productName: "Gift Packing", actualQty: count, unitLabel: null, ratePerUnit: GIFT_PACKING_RATE, amount: giftPackingCharge(count) };
}

type PackagesClient = {
  from: (table: "order_packages") => {
    select: (cols: string) => { in: (col: string, ids: string[]) => PromiseLike<{ data: { id: string; packaging_type: string }[] | null; error: { message: string } | null }> };
  };
};

// Gift packings used by an order's packed lines.
export async function loadGiftPackingCount(
  supabase: unknown,
  packedLines: { package_id: string | null }[],
): Promise<{ count: number; error?: string }> {
  const ids = [...new Set(packedLines.map((l) => l.package_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return { count: 0 };
  const { data, error } = await (supabase as PackagesClient).from("order_packages").select("id, packaging_type").in("id", ids);
  if (error) return { count: 0, error: error.message };
  return { count: countGiftPackings(packedLines, data ?? []) };
}
