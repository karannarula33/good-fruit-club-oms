import { describe, expect, it } from "vitest";
import { generateCandidate } from "@/lib/engagement/candidates";

function baseInput(overrides: Partial<Parameters<typeof generateCandidate>[0]> = {}) {
  return {
    customerId: "c1",
    state: "breaking" as const,
    phone: "9800000001",
    isVip: false,
    revenuePercentile: 0,
    orderCount: 5,
    daysSinceLast: 14,
    expectedGapDays: 3.5,
    severityRatio: 4.0,
    ...overrides,
  };
}

describe("generateCandidate", () => {
  it("generates a message candidate for a breaking customer with a phone", () => {
    const candidate = generateCandidate(baseInput());
    expect(candidate).not.toBeNull();
    expect(candidate!.triggerType).toBe("breaking");
    expect(candidate!.recommendedAction).toBe("message");
    expect(candidate!.rationale).toBe("Orders every ~3.5d, silent 14d (4.0x).");
  });

  it("generates a third_order_risk candidate", () => {
    const candidate = generateCandidate(
      baseInput({ state: "third_order_risk", orderCount: 2, daysSinceLast: 10, severityRatio: 2.0, expectedGapDays: 9 }),
    );
    expect(candidate).not.toBeNull();
    expect(candidate!.triggerType).toBe("third_order_risk");
  });

  it("returns skip_no_phone when the customer has no phone on file", () => {
    const candidate = generateCandidate(baseInput({ phone: null }));
    expect(candidate!.recommendedAction).toBe("skip_no_phone");
  });

  it("returns null for states outside this slice's scope (e.g. lapsed, drifting, habituated)", () => {
    expect(generateCandidate(baseInput({ state: "lapsed" }))).toBeNull();
    expect(generateCandidate(baseInput({ state: "drifting" }))).toBeNull();
    expect(generateCandidate(baseInput({ state: "habituated" }))).toBeNull();
    expect(generateCandidate(baseInput({ state: "second_order_risk" }))).toBeNull();
    expect(generateCandidate(baseInput({ state: "prospect" }))).toBeNull();
    expect(generateCandidate(baseInput({ state: "first_timer" }))).toBeNull();
  });

  it("folds revenue percentile into the priority score the same way computePriorityScore does", () => {
    const candidate = generateCandidate(baseInput({ revenuePercentile: 0.5 }));
    expect(candidate!.priorityScore).toBe(80); // breaking base 70 + 0.5*20
  });
});
