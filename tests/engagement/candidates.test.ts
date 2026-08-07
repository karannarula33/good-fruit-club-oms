import { describe, expect, it } from "vitest";
import { generateCandidate, determineTrigger } from "@/lib/engagement/candidates";
import type { EngagementConfig } from "@/lib/engagement/config";

const NOW = new Date("2026-08-07T00:00:00Z");

const config: EngagementConfig = {
  vipPercentile: 0.9,
  cohortDefaultGapDays: 14,
  secondOrderGraceDays: 9,
  thirdOrderGraceDays: 9,
  driftSeverityLow: 1.5,
  driftSeverityMid: 2.0,
  driftSeverityHigh: 3.5,
  lapsedAbsoluteDays: 30,
  vipCheckinIntervalDays: 10,
  frequencyCapDays: 10,
  unansweredCooldownCount: 2,
  unansweredCooldownDays: 30,
  callEscalationEnabled: true,
};

function baseInput(overrides: Partial<Parameters<typeof generateCandidate>[0]> = {}) {
  return {
    customerId: "c1",
    state: "breaking" as const,
    vipCheckin: false,
    phone: "9800000001",
    isVip: false,
    revenuePercentile: 0,
    orderCount: 5,
    daysSinceLast: 14,
    expectedGapDays: 3.5,
    severityRatio: 4.0,
    lastRelayedMessage: null,
    hasActiveSuppression: false,
    unansweredCount60d: 0,
    lastRelayedAnyAt: null,
    now: NOW,
    ...overrides,
  };
}

describe("determineTrigger", () => {
  it("returns the state itself for every active trigger", () => {
    for (const state of ["second_order_risk", "third_order_risk", "drifting", "breaking", "lapsed"] as const) {
      expect(determineTrigger(state, false)).toBe(state);
    }
  });

  it("returns vip_checkin for a habituated customer with the flag set", () => {
    expect(determineTrigger("habituated", true)).toBe("vip_checkin");
  });

  it("returns null for non-triggering states without the vip_checkin flag", () => {
    expect(determineTrigger("habituated", false)).toBeNull();
    expect(determineTrigger("first_timer", false)).toBeNull();
    expect(determineTrigger("prospect", false)).toBeNull();
  });
});

describe("generateCandidate", () => {
  it("generates a message candidate for a breaking customer with a phone", () => {
    const result = generateCandidate(baseInput(), config);
    expect(result.kind).toBe("candidate");
    if (result.kind !== "candidate") return;
    expect(result.candidate.triggerType).toBe("breaking");
    expect(result.candidate.recommendedAction).toBe("message");
    expect(result.candidate.rationale).toBe("Orders every ~3.5d, silent 14d (4.0x).");
    expect(result.candidate.isFollowup).toBe(false);
  });

  it("generates candidates for every newly-active trigger state", () => {
    for (const state of ["second_order_risk", "drifting", "lapsed"] as const) {
      const result = generateCandidate(baseInput({ state }), config);
      expect(result.kind).toBe("candidate");
      if (result.kind === "candidate") expect(result.candidate.triggerType).toBe(state);
    }
  });

  it("generates a vip_checkin candidate for a habituated VIP with the flag set", () => {
    const result = generateCandidate(baseInput({ state: "habituated", vipCheckin: true, isVip: true }), config);
    expect(result.kind).toBe("candidate");
    if (result.kind === "candidate") expect(result.candidate.triggerType).toBe("vip_checkin");
  });

  it("returns no_trigger for states with no active trigger and no vip_checkin flag", () => {
    expect(generateCandidate(baseInput({ state: "habituated" }), config).kind).toBe("no_trigger");
    expect(generateCandidate(baseInput({ state: "first_timer" }), config).kind).toBe("no_trigger");
    expect(generateCandidate(baseInput({ state: "prospect" }), config).kind).toBe("no_trigger");
  });

  it("returns skip_no_phone when the customer has no phone on file", () => {
    const result = generateCandidate(baseInput({ phone: null }), config);
    expect(result.kind).toBe("candidate");
    if (result.kind === "candidate") expect(result.candidate.recommendedAction).toBe("skip_no_phone");
  });

  it("folds revenue percentile into the priority score the same way computePriorityScore does", () => {
    const result = generateCandidate(baseInput({ revenuePercentile: 0.5 }), config);
    expect(result.kind).toBe("candidate");
    if (result.kind === "candidate") expect(result.candidate.priorityScore).toBe(80); // breaking base 70 + 0.5*20
  });

  it("escalates a lapsed customer to a call and annotates the rationale", () => {
    const result = generateCandidate(
      baseInput({
        state: "lapsed",
        lastRelayedMessage: { relayedAt: new Date(NOW.getTime() - 15 * 86_400_000), reorderedWithin14d: false },
      }),
      config,
    );
    expect(result.kind).toBe("candidate");
    if (result.kind !== "candidate") return;
    expect(result.candidate.recommendedAction).toBe("call");
    expect(result.candidate.rationale).toContain("(follow-up -- prior message unanswered)");
  });

  it("marks a breaking follow-up candidate for the draft agent", () => {
    const result = generateCandidate(
      baseInput({
        lastRelayedMessage: { relayedAt: new Date(NOW.getTime() - 14 * 86_400_000), reorderedWithin14d: false },
      }),
      config,
    );
    expect(result.kind).toBe("candidate");
    if (result.kind !== "candidate") return;
    expect(result.candidate.isFollowup).toBe(true);
    expect(result.candidate.rationale).toContain("(follow-up -- prior message unanswered)");
  });

  it("returns suppressed and requests auto-insertion once the unanswered threshold is crossed", () => {
    const result = generateCandidate(baseInput({ unansweredCount60d: 2 }), config);
    expect(result).toEqual({ kind: "suppressed", autoInsertTwoUnanswered: true });
  });

  it("returns suppressed with no auto-insert for an active suppression row", () => {
    const result = generateCandidate(baseInput({ hasActiveSuppression: true }), config);
    expect(result).toEqual({ kind: "suppressed", autoInsertTwoUnanswered: false });
  });

  it("returns suppressed within the frequency cap window", () => {
    const result = generateCandidate(
      baseInput({ lastRelayedAnyAt: new Date(NOW.getTime() - 5 * 86_400_000) }),
      config,
    );
    expect(result).toEqual({ kind: "suppressed", autoInsertTwoUnanswered: false });
  });
});
