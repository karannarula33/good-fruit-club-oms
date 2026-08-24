import { describe, expect, it } from "vitest";
import { buildFinalizeOrderPlan } from "@/lib/packing/finalize";

describe("buildFinalizeOrderPlan", () => {
  it("maps packed lines straight through with their actual qty", () => {
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "packed", actualQty: 1.8 }],
      substitutions: [],
    });
    expect(plan.lineUpdates).toEqual([{ lineId: "line-1", lineStatus: "packed", actualQty: 1.8 }]);
  });

  it("clears actualQty for unavailable lines even if one was passed in", () => {
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "unavailable", actualQty: 5 }],
      substitutions: [],
    });
    expect(plan.lineUpdates).toEqual([{ lineId: "line-1", lineStatus: "unavailable", actualQty: null }]);
  });

  it("produces no new line for an unavailable line with no substitute", () => {
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "unavailable", actualQty: null }],
      substitutions: [],
    });
    expect(plan.newSubstitutionLines).toEqual([]);
  });

  it("carries a substitution straight through with no price resolution", () => {
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "unavailable", actualQty: null }],
      substitutions: [{ substitutedForLineId: "line-1", productId: "product-kiwi", actualQty: 2 }],
    });
    expect(plan.newSubstitutionLines).toEqual([
      { productId: "product-kiwi", actualQty: 2, substitutedForLineId: "line-1" },
    ]);
  });

  it("flags shouldCancel when every line is unavailable and nothing was substituted", () => {
    const plan = buildFinalizeOrderPlan({
      resolutions: [
        { lineId: "line-1", resolution: "unavailable", actualQty: null },
        { lineId: "line-2", resolution: "unavailable", actualQty: null },
      ],
      substitutions: [],
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
    });
    expect(plan.shouldCancel).toBe(false);
  });

  it("does not flag shouldCancel when an unavailable line has a substitute", () => {
    const plan = buildFinalizeOrderPlan({
      resolutions: [{ lineId: "line-1", resolution: "unavailable", actualQty: null }],
      substitutions: [{ substitutedForLineId: "line-1", productId: "product-kiwi", actualQty: 1 }],
    });
    expect(plan.shouldCancel).toBe(false);
  });
});
