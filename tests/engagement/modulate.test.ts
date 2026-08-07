import { describe, expect, it } from "vitest";
import { modulateAction } from "@/lib/engagement/modulate";
import type { EngagementConfig } from "@/lib/engagement/config";

const NOW = new Date("2026-08-07T00:00:00Z");
const DAY = 86_400_000;

function baseConfig(overrides: Partial<EngagementConfig> = {}): EngagementConfig {
  return {
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
    ...overrides,
  };
}

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY);
}

describe("modulateAction", () => {
  it("returns skip_no_phone regardless of state or history", () => {
    const result = modulateAction(
      { state: "breaking", phone: null, lastRelayedMessage: null, now: NOW },
      baseConfig(),
    );
    expect(result).toEqual({ recommendedAction: "skip_no_phone", isFollowup: false, followupAnnotation: false });
  });

  it("escalates a lapsed customer to a call when unanswered within 21 days", () => {
    const result = modulateAction(
      {
        state: "lapsed",
        phone: "9800000001",
        lastRelayedMessage: { relayedAt: daysAgo(15), reorderedWithin14d: false },
        now: NOW,
      },
      baseConfig(),
    );
    expect(result).toEqual({ recommendedAction: "call", isFollowup: false, followupAnnotation: true });
  });

  it("keeps a lapsed customer at plain message when the prior message got a reorder", () => {
    const result = modulateAction(
      {
        state: "lapsed",
        phone: "9800000001",
        lastRelayedMessage: { relayedAt: daysAgo(15), reorderedWithin14d: true },
        now: NOW,
      },
      baseConfig(),
    );
    expect(result).toEqual({ recommendedAction: "message", isFollowup: false, followupAnnotation: false });
  });

  it("does not escalate a lapsed customer once the 21-day window has passed", () => {
    const result = modulateAction(
      {
        state: "lapsed",
        phone: "9800000001",
        lastRelayedMessage: { relayedAt: daysAgo(25), reorderedWithin14d: false },
        now: NOW,
      },
      baseConfig(),
    );
    expect(result).toEqual({ recommendedAction: "message", isFollowup: false, followupAnnotation: false });
  });

  it("falls through to the general 14d follow-up check for lapsed when call escalation is disabled", () => {
    const result = modulateAction(
      {
        state: "lapsed",
        phone: "9800000001",
        lastRelayedMessage: { relayedAt: daysAgo(15), reorderedWithin14d: false },
        now: NOW,
      },
      baseConfig({ callEscalationEnabled: false }),
    );
    expect(result).toEqual({ recommendedAction: "message", isFollowup: true, followupAnnotation: true });
  });

  it("annotates a breaking customer's second unanswered touch as a follow-up", () => {
    const result = modulateAction(
      {
        state: "breaking",
        phone: "9800000001",
        lastRelayedMessage: { relayedAt: daysAgo(14), reorderedWithin14d: false },
        now: NOW,
      },
      baseConfig(),
    );
    expect(result).toEqual({ recommendedAction: "message", isFollowup: true, followupAnnotation: true });
  });

  it("does not annotate a breaking customer before the 14d window has elapsed", () => {
    const result = modulateAction(
      {
        state: "breaking",
        phone: "9800000001",
        lastRelayedMessage: { relayedAt: daysAgo(10), reorderedWithin14d: false },
        now: NOW,
      },
      baseConfig(),
    );
    expect(result).toEqual({ recommendedAction: "message", isFollowup: false, followupAnnotation: false });
  });

  it("returns a plain message for states with no escalation/follow-up rules", () => {
    for (const state of ["second_order_risk", "third_order_risk", "drifting", "habituated"] as const) {
      const result = modulateAction(
        { state, phone: "9800000001", lastRelayedMessage: { relayedAt: daysAgo(20), reorderedWithin14d: false }, now: NOW },
        baseConfig(),
      );
      expect(result).toEqual({ recommendedAction: "message", isFollowup: false, followupAnnotation: false });
    }
  });

  it("returns a plain message when there is no nudge history at all", () => {
    const result = modulateAction({ state: "breaking", phone: "9800000001", lastRelayedMessage: null, now: NOW }, baseConfig());
    expect(result).toEqual({ recommendedAction: "message", isFollowup: false, followupAnnotation: false });
  });
});
