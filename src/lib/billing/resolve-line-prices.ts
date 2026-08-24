// Packing never resolves a price (see src/lib/packing/finalize.ts) -- price
// resolution happens entirely here, at the admin's billing step, so it
// always reflects the latest configured price against the actual packed
// qty. The one exception is a line the admin has manually overridden via
// overrideLinePrice (audited in price_overrides): that choice is final and
// is never silently re-resolved out from under them. Pure function, reused
// by generateBill (persists the result) and the admin's packed-order
// preview (display only, before Generate Bill is clicked).

import { resolveTieredPriceForProduct, type PriceItemRecord, type TierRecord } from "@/lib/pricing/resolve";

export interface BillableLineInput {
  id: string;
  productId: string | null;
  actualQty: number | null;
  lockedPricePerUnit: number | null;
}

export function resolveBillLinePrices(
  lines: BillableLineInput[],
  overriddenLineIds: Set<string>,
  priceItems: PriceItemRecord[],
  tierItems: TierRecord[],
  now: Date,
): Map<string, number | null> {
  const result = new Map<string, number | null>();
  for (const line of lines) {
    if (overriddenLineIds.has(line.id)) {
      result.set(line.id, line.lockedPricePerUnit);
      continue;
    }
    if (!line.productId) {
      result.set(line.id, null);
      continue;
    }
    const resolved = resolveTieredPriceForProduct(priceItems, tierItems, line.productId, now, line.actualQty ?? 0);
    result.set(line.id, resolved?.pricePerUnit ?? null);
  }
  return result;
}
