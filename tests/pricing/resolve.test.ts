import { describe, expect, it } from "vitest";
import { resolvePrices, resolvePriceForProduct, type PriceItemRecord } from "@/lib/pricing/resolve";

const MANGO = "product-mango";
const BANANA = "product-banana";

function item(
  productId: string,
  pricePerUnit: number,
  effectiveFrom: string,
  versionCreatedAt = effectiveFrom,
): PriceItemRecord {
  return {
    productId,
    pricePerUnit,
    effectiveFrom: new Date(effectiveFrom),
    versionCreatedAt: new Date(versionCreatedAt),
  };
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
