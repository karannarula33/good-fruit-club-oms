import { describe, expect, it } from "vitest";
import { resolveBillLinePrices } from "@/lib/billing/resolve-line-prices";
import type { PriceItemRecord, TierRecord } from "@/lib/pricing/resolve";

const MANGO = "product-mango";

let nextPriceItemId = 0;

function priceItem(
  productId: string,
  pricePerUnit: number,
  effectiveFrom: string,
  priceItemId = `price-item-${++nextPriceItemId}`,
): PriceItemRecord {
  return {
    priceItemId,
    productId,
    pricePerUnit,
    effectiveFrom: new Date(effectiveFrom),
    versionCreatedAt: new Date(effectiveFrom),
  };
}

function tier(priceItemId: string, minQty: number, pricePerUnit: number): TierRecord {
  return { priceItemId, minQty, pricePerUnit };
}

describe("resolveBillLinePrices", () => {
  it("resolves the latest configured price at billing time, ignoring any stale locked value", () => {
    const priceItems = [
      priceItem(MANGO, 950, "2026-07-01T00:00:00Z"),
      priceItem(MANGO, 990, "2026-08-19T00:00:00Z"), // latest
    ];
    const result = resolveBillLinePrices(
      [{ id: "line-1", productId: MANGO, actualQty: 2, lockedPricePerUnit: 500 }], // stale order-entry estimate
      new Set(),
      priceItems,
      [],
      new Date("2026-08-24T03:52:00Z"),
    );
    expect(result.get("line-1")).toBe(990);
  });

  it("selects the tier matching the actual packed qty", () => {
    const priceItems = [priceItem(MANGO, 990, "2026-08-19T00:00:00Z", "pi-current")];
    const tierItems = [tier("pi-current", 5, 900)];
    const result = resolveBillLinePrices(
      [{ id: "line-1", productId: MANGO, actualQty: 6, lockedPricePerUnit: null }],
      new Set(),
      priceItems,
      tierItems,
      new Date("2026-08-24T03:52:00Z"),
    );
    expect(result.get("line-1")).toBe(900);
  });

  it("passes an overridden line's locked price straight through untouched", () => {
    const priceItems = [priceItem(MANGO, 990, "2026-08-19T00:00:00Z")];
    const result = resolveBillLinePrices(
      [{ id: "line-1", productId: MANGO, actualQty: 2, lockedPricePerUnit: 1200 }],
      new Set(["line-1"]),
      priceItems,
      [],
      new Date("2026-08-24T03:52:00Z"),
    );
    expect(result.get("line-1")).toBe(1200);
  });

  it("returns null, never zero, when the product genuinely has no active price", () => {
    const result = resolveBillLinePrices(
      [{ id: "line-1", productId: MANGO, actualQty: 2, lockedPricePerUnit: null }],
      new Set(),
      [],
      [],
      new Date("2026-08-24T03:52:00Z"),
    );
    expect(result.get("line-1")).toBeNull();
  });

  it("returns null for a line with no product (e.g. an unmapped parse)", () => {
    const result = resolveBillLinePrices(
      [{ id: "line-1", productId: null, actualQty: 2, lockedPricePerUnit: null }],
      new Set(),
      [priceItem(MANGO, 990, "2026-08-19T00:00:00Z")],
      [],
      new Date("2026-08-24T03:52:00Z"),
    );
    expect(result.get("line-1")).toBeNull();
  });
});
