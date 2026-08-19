// CLAUDE.md §3.3/§3.4: per line, packing resolves to exactly one of
// "packed" (actual qty entered) or "unavailable" (drops from billing).
// A substitution is an optional enhancement on top of "unavailable" --
// it has no price lock from order entry, so it prices at the version
// active at substitution time (now, at packing), never at the order's
// original placed_at. Pure function so the server action stays thin and
// this is independently testable.
//
// Quantity-tiered pricing (deliberate, scoped exception to §3.1's "locked
// at creation, never recomputed"): a regular packed line's final rate is
// resolved here, at packing, against the ordered-quantity tier schedule
// using the *actual* qty just recorded -- the price *version* still pins
// to the order's original placedAt (§3.2), only which tier within that
// version is deferred until the real billable quantity is known.

import { resolveTieredPriceForProduct, type PriceItemRecord, type TierRecord } from "@/lib/pricing/resolve";

export interface PackingLineResolution {
  lineId: string;
  resolution: "packed" | "unavailable";
  actualQty: number | null;
}

export interface SubstitutionInput {
  substitutedForLineId: string;
  productId: string;
  actualQty: number;
}

export interface LineUpdate {
  lineId: string;
  lineStatus: "packed" | "unavailable";
  actualQty: number | null;
  lockedPricePerUnit: number | null;
}

export interface NewSubstitutionLine {
  productId: string;
  actualQty: number;
  lockedPricePerUnit: number | null;
  substitutedForLineId: string;
}

export interface FinalizeOrderPlan {
  lineUpdates: LineUpdate[];
  newSubstitutionLines: NewSubstitutionLine[];
  // True when nothing on the order actually got packed -- every line was
  // marked unavailable and none of them had a substitute. The caller uses
  // this to close the order out as cancelled instead of packed, rather
  // than leaving a ₹0 "ready to bill" order in the queue.
  shouldCancel: boolean;
}

export function buildFinalizeOrderPlan(params: {
  resolutions: PackingLineResolution[];
  substitutions: SubstitutionInput[];
  priceItems: PriceItemRecord[];
  tierItems: TierRecord[];
  productIdByLineId: Map<string, string>;
  placedAt: Date;
  now: Date;
}): FinalizeOrderPlan {
  const lineUpdates: LineUpdate[] = params.resolutions.map((resolution) => {
    const actualQty = resolution.resolution === "packed" ? resolution.actualQty : null;
    const productId = params.productIdByLineId.get(resolution.lineId);
    const lockedPricePerUnit =
      resolution.resolution === "packed" && productId && actualQty !== null
        ? (resolveTieredPriceForProduct(
            params.priceItems,
            params.tierItems,
            productId,
            params.placedAt,
            actualQty,
          )?.pricePerUnit ?? null)
        : null;
    return {
      lineId: resolution.lineId,
      lineStatus: resolution.resolution,
      actualQty,
      lockedPricePerUnit,
    };
  });

  const newSubstitutionLines: NewSubstitutionLine[] = params.substitutions.map((substitution) => ({
    productId: substitution.productId,
    actualQty: substitution.actualQty,
    lockedPricePerUnit:
      resolveTieredPriceForProduct(
        params.priceItems,
        params.tierItems,
        substitution.productId,
        params.now,
        substitution.actualQty,
      )?.pricePerUnit ?? null,
    substitutedForLineId: substitution.substitutedForLineId,
  }));

  const shouldCancel =
    !lineUpdates.some((update) => update.lineStatus === "packed") && newSubstitutionLines.length === 0;

  return { lineUpdates, newSubstitutionLines, shouldCancel };
}
