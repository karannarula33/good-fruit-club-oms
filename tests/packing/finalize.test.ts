import { describe, expect, it } from "vitest";
import { buildFinalizeOrderPlan } from "@/lib/packing/finalize";
import type { PriceItemRecord, TierRecord } from "@/lib/pricing/resolve";

const MANGO = "product-mango";
const KIWI = "product-kiwi";
const PLACED_AT = new Date("2026-07-20T05:00:00Z");

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

describe("buildFinalizeOrderPlan", () => {
  it("maps packed lines straight through with their actual qty", () => {
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "packed", actualQty: 1.8 }],
      substitutions: [],
      priceItems: [],
      tierItems: [],
      productIdByLineId: new Map(),
      placedAt: PLACED_AT,
      now: new Date("2026-07-27T06:00:00Z"),
    });
    expect(plan.lineUpdates).toEqual([
      { lineId: "line-1", lineStatus: "packed", actualQty: 1.8, lockedPricePerUnit: null },
    ]);
  });

  it("clears actualQty for unavailable lines even if one was passed in", () => {
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "unavailable", actualQty: 5 }],
      substitutions: [],
      priceItems: [],
      tierItems: [],
      productIdByLineId: new Map(),
      placedAt: PLACED_AT,
      now: new Date("2026-07-27T06:00:00Z"),
    });
    expect(plan.lineUpdates).toEqual([
      { lineId: "line-1", lineStatus: "unavailable", actualQty: null, lockedPricePerUnit: null },
    ]);
  });

  it("produces no new line for an unavailable line with no substitute", () => {
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "unavailable", actualQty: null }],
      substitutions: [],
      priceItems: [],
      tierItems: [],
      productIdByLineId: new Map(),
      placedAt: PLACED_AT,
      now: new Date("2026-07-27T06:00:00Z"),
    });
    expect(plan.newSubstitutionLines).toEqual([]);
  });

  it("resolves a packed line's price at the order's placedAt, using the actual qty", () => {
    const priceItems = [
      priceItem(MANGO, 950, "2026-07-01T00:00:00Z"), // superseded
      priceItem(MANGO, 990, "2026-07-19T00:00:00Z", "pi-current"), // active as of placedAt
      priceItem(MANGO, 1200, "2026-08-01T00:00:00Z"), // future, must not apply
    ];
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "packed", actualQty: 3 }],
      substitutions: [],
      priceItems,
      tierItems: [],
      productIdByLineId: new Map([["line-1", MANGO]]),
      placedAt: PLACED_AT,
      now: new Date("2026-08-15T00:00:00Z"),
    });
    expect(plan.lineUpdates).toEqual([
      { lineId: "line-1", lineStatus: "packed", actualQty: 3, lockedPricePerUnit: 990 },
    ]);
  });

  it("prices a packed line at the tier matching actual qty, not ordered qty", () => {
    const priceItems = [priceItem(MANGO, 990, "2026-07-19T00:00:00Z", "pi-current")];
    const tierItems = [tier("pi-current", 5, 900)];
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "packed", actualQty: 6 }],
      substitutions: [],
      priceItems,
      tierItems,
      productIdByLineId: new Map([["line-1", MANGO]]),
      placedAt: PLACED_AT,
      now: new Date("2026-08-15T00:00:00Z"),
    });
    expect(plan.lineUpdates[0].lockedPricePerUnit).toBe(900);
  });

  it("falls back to the base price when actual qty stays below every tier", () => {
    const priceItems = [priceItem(MANGO, 990, "2026-07-19T00:00:00Z", "pi-current")];
    const tierItems = [tier("pi-current", 5, 900)];
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "packed", actualQty: 2 }],
      substitutions: [],
      priceItems,
      tierItems,
      productIdByLineId: new Map([["line-1", MANGO]]),
      placedAt: PLACED_AT,
      now: new Date("2026-08-15T00:00:00Z"),
    });
    expect(plan.lineUpdates[0].lockedPricePerUnit).toBe(990);
  });

  it("resolves a substitution's price at 'now', independent of any order placed_at", () => {
    const priceItems = [
      priceItem(KIWI, 100, "2026-01-01T00:00:00Z"), // old price
      priceItem(KIWI, 150, "2026-07-27T00:00:00Z"), // current price
    ];
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "unavailable", actualQty: null }],
      substitutions: [{ substitutedForLineId: "line-1", productId: KIWI, actualQty: 2 }],
      priceItems,
      tierItems: [],
      productIdByLineId: new Map(),
      placedAt: PLACED_AT,
      now: new Date("2026-07-27T09:00:00Z"),
    });
    expect(plan.newSubstitutionLines).toEqual([
      { productId: KIWI, actualQty: 2, lockedPricePerUnit: 150, substitutedForLineId: "line-1" },
    ]);
  });

  it("prices a substitution at the tier matching its own actual qty", () => {
    const priceItems = [priceItem(KIWI, 150, "2026-07-27T00:00:00Z", "pi-kiwi")];
    const tierItems = [tier("pi-kiwi", 3, 130)];
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "unavailable", actualQty: null }],
      substitutions: [{ substitutedForLineId: "line-1", productId: KIWI, actualQty: 4 }],
      priceItems,
      tierItems,
      productIdByLineId: new Map(),
      placedAt: PLACED_AT,
      now: new Date("2026-07-27T09:00:00Z"),
    });
    expect(plan.newSubstitutionLines[0].lockedPricePerUnit).toBe(130);
  });

  it("never defaults to zero when the substitute product has no active price", () => {
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "unavailable", actualQty: null }],
      substitutions: [{ substitutedForLineId: "line-1", productId: MANGO, actualQty: 1 }],
      priceItems: [],
      tierItems: [],
      productIdByLineId: new Map(),
      placedAt: PLACED_AT,
      now: new Date("2026-07-27T09:00:00Z"),
    });
    expect(plan.newSubstitutionLines[0].lockedPricePerUnit).toBeNull();
  });

  it("flags shouldCancel when every line is unavailable and nothing was substituted", () => {
    const plan = buildFinalizeOrderPlan({
      resolutions: [
        { lineId: "line-1", resolution: "unavailable", actualQty: null },
        { lineId: "line-2", resolution: "unavailable", actualQty: null },
      ],
      substitutions: [],
      priceItems: [],
      tierItems: [],
      productIdByLineId: new Map(),
      placedAt: PLACED_AT,
      now: new Date("2026-07-27T09:00:00Z"),
    });
    expect(plan.shouldCancel).toBe(true);
  });

  it("does not flag shouldCancel when at least one line is packed", () => {
    const plan = buildFinalizeOrderPlan({
      resolutions: [
        { lineId: "line-1", resolution: "packed", actualQty: 2 },
        { lineId: "line-2", resolution: "unavailable", actualQty: null },
      ],
      substitutions: [],
      priceItems: [],
      tierItems: [],
      productIdByLineId: new Map(),
      placedAt: PLACED_AT,
      now: new Date("2026-07-27T09:00:00Z"),
    });
    expect(plan.shouldCancel).toBe(false);
  });

  it("does not flag shouldCancel when an unavailable line has a substitute", () => {
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "unavailable", actualQty: null }],
      substitutions: [{ substitutedForLineId: "line-1", productId: KIWI, actualQty: 1 }],
      priceItems: [priceItem(KIWI, 150, "2026-07-27T00:00:00Z")],
      tierItems: [],
      productIdByLineId: new Map(),
      placedAt: PLACED_AT,
      now: new Date("2026-07-27T09:00:00Z"),
    });
    expect(plan.shouldCancel).toBe(false);
  });
});
