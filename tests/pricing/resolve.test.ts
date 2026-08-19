import { describe, expect, it } from "vitest";
import {
  resolvePrices,
  resolvePriceForProduct,
  applyTier,
  resolveTieredPriceForProduct,
  type PriceItemRecord,
  type TierRecord,
} from "@/lib/pricing/resolve";

const MANGO = "product-mango";
const BANANA = "product-banana";

let nextPriceItemId = 0;

function item(
  productId: string,
  pricePerUnit: number,
  effectiveFrom: string,
  versionCreatedAt = effectiveFrom,
  priceItemId = `price-item-${++nextPriceItemId}`,
): PriceItemRecord {
  return {
    priceItemId,
    productId,
    pricePerUnit,
    effectiveFrom: new Date(effectiveFrom),
    versionCreatedAt: new Date(versionCreatedAt),
  };
}

function tier(priceItemId: string, minQty: number, pricePerUnit: number): TierRecord {
  return { priceItemId, minQty, pricePerUnit };
}

describe("resolvePrices", () => {
  it("resolves the single version for a single product", () => {
    const items = [item(MANGO, 295, "2026-07-27T00:30:00Z")];
    const resolved = resolvePrices(items, new Date("2026-07-27T12:00:00Z"));
    expect(resolved.get(MANGO)?.pricePerUnit).toBe(295);
  });

  it("picks the later effective_from when a product appears in two versions", () => {
    const items = [
      item(MANGO, 295, "2026-07-26T00:30:00Z"),
      item(MANGO, 310, "2026-07-27T00:30:00Z"),
    ];
    const resolved = resolvePrices(items, new Date("2026-07-27T12:00:00Z"));
    expect(resolved.get(MANGO)?.pricePerUnit).toBe(310);
  });

  it("carries forward a product not mentioned in a later version", () => {
    // Version A prices mango and banana; version B only re-prices banana.
    // Mango must still resolve from version A after B's effective_from.
    const items = [
      item(MANGO, 295, "2026-07-26T00:30:00Z", "2026-07-26T00:30:00Z"),
      item(BANANA, 60, "2026-07-26T00:30:00Z", "2026-07-26T00:30:00Z"),
      item(BANANA, 65, "2026-07-27T00:30:00Z", "2026-07-27T00:30:00Z"),
    ];
    const resolved = resolvePrices(items, new Date("2026-07-28T00:00:00Z"));
    expect(resolved.get(MANGO)?.pricePerUnit).toBe(295);
    expect(resolved.get(BANANA)?.pricePerUnit).toBe(65);
  });

  it("returns no entry when asOf is before any version", () => {
    const items = [item(MANGO, 295, "2026-07-27T00:30:00Z")];
    const resolved = resolvePrices(items, new Date("2026-07-01T00:00:00Z"));
    expect(resolved.has(MANGO)).toBe(false);
  });

  it("includes a version exactly at effective_from (boundary is inclusive)", () => {
    const items = [item(MANGO, 295, "2026-07-27T00:30:00Z")];
    const resolved = resolvePrices(items, new Date("2026-07-27T00:30:00Z"));
    expect(resolved.get(MANGO)?.pricePerUnit).toBe(295);
  });

  it("ignores versions effective in the future relative to asOf", () => {
    const items = [
      item(MANGO, 295, "2026-07-27T00:30:00Z"),
      item(MANGO, 999, "2099-01-01T00:00:00Z"),
    ];
    const resolved = resolvePrices(items, new Date("2026-07-27T12:00:00Z"));
    expect(resolved.get(MANGO)?.pricePerUnit).toBe(295);
  });

  it("tie-breaks identical effective_from by the later-published version", () => {
    const items = [
      item(MANGO, 295, "2026-07-27T00:30:00Z", "2026-07-27T00:30:00Z"),
      item(MANGO, 300, "2026-07-27T00:30:00Z", "2026-07-27T09:00:00Z"),
    ];
    const resolved = resolvePrices(items, new Date("2026-07-27T12:00:00Z"));
    expect(resolved.get(MANGO)?.pricePerUnit).toBe(300);
  });

  it("resolves to null for a product with zero price_items", () => {
    const resolved = resolvePriceForProduct([], MANGO, new Date());
    expect(resolved).toBeNull();
  });

  it("never defaults an unresolved product to zero", () => {
    const items = [item(MANGO, 295, "2099-01-01T00:00:00Z")];
    const resolved = resolvePriceForProduct(items, MANGO, new Date("2026-07-27T00:00:00Z"));
    expect(resolved).toBeNull();
  });
});

describe("applyTier", () => {
  it("returns the base rate when there are no tiers", () => {
    expect(applyTier(990, [], 7)).toBe(990);
  });

  it("returns the base rate when qty is below every tier threshold", () => {
    const tiers = [tier("pi-1", 5, 900)];
    expect(applyTier(990, tiers, 3)).toBe(990);
  });

  it("picks the highest threshold the qty meets", () => {
    const tiers = [tier("pi-1", 5, 900), tier("pi-1", 10, 850)];
    expect(applyTier(990, tiers, 7)).toBe(900);
    expect(applyTier(990, tiers, 10)).toBe(850);
    expect(applyTier(990, tiers, 20)).toBe(850);
  });

  it("treats the threshold boundary as inclusive", () => {
    const tiers = [tier("pi-1", 5, 900)];
    expect(applyTier(990, tiers, 5)).toBe(900);
  });
});

describe("resolveTieredPriceForProduct", () => {
  it("applies the tier belonging to the resolved price_items row", () => {
    const mangoItem = item(MANGO, 990, "2026-07-27T00:00:00Z", "2026-07-27T00:00:00Z", "pi-mango");
    const items = [mangoItem];
    const tiers = [tier("pi-mango", 5, 900)];
    const resolved = resolveTieredPriceForProduct(items, tiers, MANGO, new Date("2026-07-27T12:00:00Z"), 7);
    expect(resolved?.pricePerUnit).toBe(900);
  });

  it("ignores tiers attached to a superseded price_items row", () => {
    const oldItem = item(MANGO, 950, "2026-07-01T00:00:00Z", "2026-07-01T00:00:00Z", "pi-old");
    const newItem = item(MANGO, 990, "2026-07-27T00:00:00Z", "2026-07-27T00:00:00Z", "pi-new");
    const items = [oldItem, newItem];
    // A bulk tier that only ever existed on the old (superseded) row must
    // not leak into resolution against the new one.
    const tiers = [tier("pi-old", 5, 800)];
    const resolved = resolveTieredPriceForProduct(items, tiers, MANGO, new Date("2026-07-27T12:00:00Z"), 7);
    expect(resolved?.pricePerUnit).toBe(990);
  });

  it("never defaults to zero when the product has no resolvable base price", () => {
    const resolved = resolveTieredPriceForProduct([], [], MANGO, new Date(), 7);
    expect(resolved).toBeNull();
  });
});
