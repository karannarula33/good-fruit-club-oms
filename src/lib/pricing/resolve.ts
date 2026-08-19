// Price resolution per CLAUDE.md §3.2: for any product, the resolved price
// is the price_item belonging to the most recently effective price_version
// whose effective_from <= the target instant. Deliberately a pure function
// (no DB access) so it can be unit tested and reused as-is for order
// price-locking (Slice 4), where `asOf` is the order's placed_at.

export interface PriceItemRecord {
  priceItemId: string;
  productId: string;
  pricePerUnit: number;
  effectiveFrom: Date;
  versionCreatedAt: Date;
}

export interface ResolvedPrice {
  priceItemId: string;
  productId: string;
  pricePerUnit: number;
  effectiveFrom: Date;
}

export interface TierRecord {
  priceItemId: string;
  minQty: number;
  pricePerUnit: number;
}

export function resolvePrices(
  items: PriceItemRecord[],
  asOf: Date,
): Map<string, ResolvedPrice> {
  const best = new Map<string, PriceItemRecord>();

  for (const item of items) {
    if (item.effectiveFrom.getTime() > asOf.getTime()) continue;

    const current = best.get(item.productId);
    if (!current) {
      best.set(item.productId, item);
      continue;
    }

    const itemIsNewer = item.effectiveFrom.getTime() > current.effectiveFrom.getTime();
    const itemIsTiedButPublishedLater =
      item.effectiveFrom.getTime() === current.effectiveFrom.getTime() &&
      item.versionCreatedAt.getTime() > current.versionCreatedAt.getTime();

    if (itemIsNewer || itemIsTiedButPublishedLater) {
      best.set(item.productId, item);
    }
  }

  const resolved = new Map<string, ResolvedPrice>();
  for (const [productId, item] of best) {
    resolved.set(productId, {
      priceItemId: item.priceItemId,
      productId,
      pricePerUnit: item.pricePerUnit,
      effectiveFrom: item.effectiveFrom,
    });
  }
  return resolved;
}

export function resolvePriceForProduct(
  items: PriceItemRecord[],
  productId: string,
  asOf: Date,
): ResolvedPrice | null {
  const resolved = resolvePrices(
    items.filter((item) => item.productId === productId),
    asOf,
  );
  return resolved.get(productId) ?? null;
}

// Picks the highest minQty threshold the given qty meets, falling back to
// the base rate when qty is below every tier (or there are none). Tiers
// belonging to a different price_items row than the resolved base price
// are the caller's responsibility to exclude -- see
// resolveTieredPriceForProduct, which does that filtering.
export function applyTier(basePricePerUnit: number, tiers: TierRecord[], qty: number): number {
  let best = basePricePerUnit;
  let bestMinQty = 0;
  for (const tier of tiers) {
    if (qty >= tier.minQty && tier.minQty > bestMinQty) {
      best = tier.pricePerUnit;
      bestMinQty = tier.minQty;
    }
  }
  return best;
}

export function resolveTieredPriceForProduct(
  items: PriceItemRecord[],
  tiers: TierRecord[],
  productId: string,
  asOf: Date,
  qty: number,
): ResolvedPrice | null {
  const base = resolvePriceForProduct(items, productId, asOf);
  if (!base) return null;

  const matchingTiers = tiers.filter((tier) => tier.priceItemId === base.priceItemId);
  return {
    ...base,
    pricePerUnit: applyTier(base.pricePerUnit, matchingTiers, qty),
  };
}
