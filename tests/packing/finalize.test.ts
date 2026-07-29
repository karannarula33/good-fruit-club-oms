import { describe, expect, it } from "vitest";
import { buildFinalizeOrderPlan } from "@/lib/packing/finalize";
import type { PriceItemRecord } from "@/lib/pricing/resolve";

const MANGO = "product-mango";
const KIWI = "product-kiwi";

function priceItem(productId: string, pricePerUnit: number, effectiveFrom: string): PriceItemRecord {
  return {
    productId,
    pricePerUnit,
    effectiveFrom: new Date(effectiveFrom),
    versionCreatedAt: new Date(effectiveFrom),
  };
}

describe("buildFinalizeOrderPlan", () => {
  it("maps packed lines straight through with their actual qty", () => {
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "packed", actualQty: 1.8 }],
      substitutions: [],
      priceItems: [],
      now: new Date("2026-07-27T06:00:00Z"),
    });
    expect(plan.lineUpdates).toEqual([{ lineId: "line-1", lineStatus: "packed", actualQty: 1.8 }]);
  });

  it("clears actualQty for unavailable lines even if one was passed in", () => {
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "unavailable", actualQty: 5 }],
      substitutions: [],
      priceItems: [],
      now: new Date("2026-07-27T06:00:00Z"),
    });
    expect(plan.lineUpdates).toEqual([{ lineId: "line-1", lineStatus: "unavailable", actualQty: null }]);
  });

  it("produces no new line for an unavailable line with no substitute", () => {
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "unavailable", actualQty: null }],
      substitutions: [],
      priceItems: [],
      now: new Date("2026-07-27T06:00:00Z"),
    });
    expect(plan.newSubstitutionLines).toEqual([]);
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
      now: new Date("2026-07-27T09:00:00Z"),
    });
    expect(plan.newSubstitutionLines).toEqual([
      { productId: KIWI, actualQty: 2, lockedPricePerUnit: 150, substitutedForLineId: "line-1" },
    ]);
  });

  it("never defaults to zero when the substitute product has no active price", () => {
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "unavailable", actualQty: null }],
      substitutions: [{ substitutedForLineId: "line-1", productId: MANGO, actualQty: 1 }],
      priceItems: [],
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
      now: new Date("2026-07-27T09:00:00Z"),
    });
    expect(plan.shouldCancel).toBe(false);
  });

  it("does not flag shouldCancel when an unavailable line has a substitute", () => {
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "unavailable", actualQty: null }],
      substitutions: [{ substitutedForLineId: "line-1", productId: KIWI, actualQty: 1 }],
      priceItems: [priceItem(KIWI, 150, "2026-07-27T00:00:00Z")],
      now: new Date("2026-07-27T09:00:00Z"),
    });
    expect(plan.shouldCancel).toBe(false);
  });
});
