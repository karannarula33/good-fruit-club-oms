import { describe, expect, it } from "vitest";
import { planAdvanceAllocation, type AdvanceCredit } from "@/lib/billing/allocate";

function advance(ledgerEntryId: string, amount: number, allocatedSoFar: number, createdAt: string): AdvanceCredit {
  return { ledgerEntryId, amount, allocatedSoFar, createdAt: new Date(createdAt) };
}

describe("planAdvanceAllocation", () => {
  it("returns an empty plan when there are no advances", () => {
    expect(planAdvanceAllocation({ advances: [], billTotal: 500 })).toEqual([]);
  });

  it("fully covers the bill from a single sufficient advance", () => {
    const plan = planAdvanceAllocation({
      advances: [advance("adv-1", 1000, 0, "2026-01-01")],
      billTotal: 500,
    });
    expect(plan).toEqual([{ ledgerEntryId: "adv-1", amount: 500 }]);
  });

  it("only takes what an insufficient advance has, leaving the bill partially covered", () => {
    const plan = planAdvanceAllocation({
      advances: [advance("adv-1", 200, 0, "2026-01-01")],
      billTotal: 500,
    });
    expect(plan).toEqual([{ ledgerEntryId: "adv-1", amount: 200 }]);
  });

  it("spans multiple advances oldest-first to cover one bill", () => {
    const plan = planAdvanceAllocation({
      advances: [advance("adv-newer", 300, 0, "2026-02-01"), advance("adv-older", 300, 0, "2026-01-01")],
      billTotal: 500,
    });
    expect(plan).toEqual([
      { ledgerEntryId: "adv-older", amount: 300 },
      { ledgerEntryId: "adv-newer", amount: 200 },
    ]);
  });

  it("leaves the remainder on an advance larger than the bill for next time", () => {
    const plan = planAdvanceAllocation({
      advances: [advance("adv-1", 1000, 0, "2026-01-01")],
      billTotal: 300,
    });
    expect(plan).toEqual([{ ledgerEntryId: "adv-1", amount: 300 }]);
  });

  it("only offers the remainder of an already-partially-allocated advance", () => {
    const plan = planAdvanceAllocation({
      advances: [advance("adv-1", 1000, 700, "2026-01-01")],
      billTotal: 500,
    });
    expect(plan).toEqual([{ ledgerEntryId: "adv-1", amount: 300 }]);
  });

  it("skips fully-exhausted advances", () => {
    const plan = planAdvanceAllocation({
      advances: [advance("adv-exhausted", 500, 500, "2026-01-01"), advance("adv-1", 400, 0, "2026-01-02")],
      billTotal: 300,
    });
    expect(plan).toEqual([{ ledgerEntryId: "adv-1", amount: 300 }]);
  });
});
