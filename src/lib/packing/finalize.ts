// CLAUDE.md §3.3/§3.4: per line, packing resolves to exactly one of
// "packed" (actual qty entered) or "unavailable" (drops from billing).
// A substitution is an optional enhancement on top of "unavailable" --
// it has no price lock from order entry, so it prices at the version
// active at substitution time (now, at packing), never at the order's
// original placed_at. Pure function so the server action stays thin and
// this is independently testable.

import { resolvePriceForProduct, type PriceItemRecord } from "@/lib/pricing/resolve";

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
}

export function buildFinalizeOrderPlan(params: {
  resolutions: PackingLineResolution[];
  substitutions: SubstitutionInput[];
  priceItems: PriceItemRecord[];
  now: Date;
}): FinalizeOrderPlan {
  const lineUpdates: LineUpdate[] = params.resolutions.map((resolution) => ({
    lineId: resolution.lineId,
    lineStatus: resolution.resolution,
    actualQty: resolution.resolution === "packed" ? resolution.actualQty : null,
  }));

  const newSubstitutionLines: NewSubstitutionLine[] = params.substitutions.map((substitution) => ({
    productId: substitution.productId,
    actualQty: substitution.actualQty,
    lockedPricePerUnit:
      resolvePriceForProduct(params.priceItems, substitution.productId, params.now)?.pricePerUnit ?? null,
    substitutedForLineId: substitution.substitutedForLineId,
  }));

  return { lineUpdates, newSubstitutionLines };
}
