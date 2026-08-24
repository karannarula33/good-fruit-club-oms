// CLAUDE.md §3.3/§3.4: per line, packing resolves to exactly one of
// "packed" (actual qty entered) or "unavailable" (drops from billing).
// A substitution is an optional enhancement on top of "unavailable".
// Pure function so the server action stays thin and this is independently
// testable.
//
// Packing is deliberately price-blind: packers must not need any read
// access to price_items/price_versions/price_tiers (those stay RLS
// admin-only), so this plan never resolves a price. Pricing -- including
// quantity-tiered pricing against the actual packed qty -- is resolved
// entirely at the billing step (see src/lib/billing/resolve-line-prices.ts),
// which always reflects the latest configured price and runs admin-only.

export interface PackingLineResolution {
  lineId: string;
  resolution: "packed" | "unavailable";
  actualQty: number | null;
  // Which box/packet this line went into -- "" or existing order_packages
  // uuid or a client tempId for a not-yet-saved package. Resolved to a real
  // package_id by the finalizeOrder action.
  packageRef?: string | null;
}

export interface SubstitutionInput {
  substitutedForLineId: string;
  productId: string;
  actualQty: number;
  packageRef?: string | null;
}

export interface LineUpdate {
  lineId: string;
  lineStatus: "packed" | "unavailable";
  actualQty: number | null;
}

export interface NewSubstitutionLine {
  productId: string;
  actualQty: number;
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
}): FinalizeOrderPlan {
  const lineUpdates: LineUpdate[] = params.resolutions.map((resolution) => ({
    lineId: resolution.lineId,
    lineStatus: resolution.resolution,
    actualQty: resolution.resolution === "packed" ? resolution.actualQty : null,
  }));

  const newSubstitutionLines: NewSubstitutionLine[] = params.substitutions.map((substitution) => ({
    productId: substitution.productId,
    actualQty: substitution.actualQty,
    substitutedForLineId: substitution.substitutedForLineId,
  }));

  const shouldCancel =
    !lineUpdates.some((update) => update.lineStatus === "packed") && newSubstitutionLines.length === 0;

  return { lineUpdates, newSubstitutionLines, shouldCancel };
}
