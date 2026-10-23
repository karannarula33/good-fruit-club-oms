// 500g / 1 kg pricing (admin, 2026-10-23). Many fruits sell at one price for
// 500g and a lower per-kg price for 1 kg ("₹600/500g, ₹1,150/kg"). Rule:
// a billed weight below 0.7 kg is charged at the 500g rate (₹600/500g =
// ₹1,200/kg), 0.7 kg and up at the 1 kg rate. No tiers above 1 kg.
//
// Stored with the existing quantity tiers (0017_price_tiers.sql): the base
// per-kg price is twice the 500g price, plus one tier from 0.7 kg at the
// 1 kg rate -- resolveTieredPriceForProduct already picks it by weight.

export const KG_RATE_FROM_QTY = 0.7;

export interface PackPricedItem {
  pricePerUnit: number;
  tiers: { minQty: number; pricePerUnit: number }[];
}

// kgPrice: the 1 kg price (per kg); halfKgPrice: the price of 500g. Either
// may be missing. Returns null when neither is a usable price.
export function packPricesToItem(kgPrice: number | null, halfKgPrice: number | null): PackPricedItem | null {
  const kg = kgPrice !== null && Number.isFinite(kgPrice) && kgPrice > 0 ? kgPrice : null;
  const half = halfKgPrice !== null && Number.isFinite(halfKgPrice) && halfKgPrice > 0 ? halfKgPrice : null;
  if (half === null) return kg === null ? null : { pricePerUnit: kg, tiers: [] };
  const base = Math.round(half * 2 * 100) / 100;
  if (kg === null || kg === base) return { pricePerUnit: base, tiers: [] };
  return { pricePerUnit: base, tiers: [{ minQty: KG_RATE_FROM_QTY, pricePerUnit: kg }] };
}

// The reverse, for display: a price item with exactly the 0.7 kg tier reads
// back as its 500g and 1 kg prices.
export function itemToPackPrices(
  pricePerUnit: number,
  tiers: { minQty: number; pricePerUnit: number }[],
): { halfKgPrice: number; kgPrice: number } | null {
  if (tiers.length !== 1 || tiers[0].minQty !== KG_RATE_FROM_QTY) return null;
  return { halfKgPrice: Math.round((pricePerUnit / 2) * 100) / 100, kgPrice: tiers[0].pricePerUnit };
}
