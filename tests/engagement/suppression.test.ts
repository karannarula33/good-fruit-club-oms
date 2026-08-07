import { describe, expect, it } from "vitest";
import { evaluateSuppression } from "@/lib/engagement/suppression";
import type { EngagementConfig } from "@/lib/engagement/config";

const NOW = new Date("2026-08-07T00:00:00Z");
const DAY = 86_400_000;

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

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY);
}

describe("evaluateSuppression", () => {
  it("suppresses when an active suppression row exists, regardless of other inputs", () => {
    const result = evaluateSuppression(
      { hasActiveSuppression: true, unansweredCount60d: 0, lastRelayedAnyAt: null, now: NOW },
      config,
    );
    expect(result).toEqual({ suppressed: true, autoInsertTwoUnanswered: false });
  });

  it("auto-inserts two_unanswered once the unanswered count crosses the threshold", () => {
    const result = evaluateSuppression(
      { hasActiveSuppression: false, unansweredCount60d: 2, lastRelayedAnyAt: null, now: NOW },
      config,
    );
    expect(result).toEqual({ suppressed: true, autoInsertTwoUnanswered: true });
  });

  it("does not suppress below the unanswered threshold", () => {
    const result = evaluateSuppression(
      { hasActiveSuppression: false, unansweredCount60d: 1, lastRelayedAnyAt: null, now: NOW },
      config,
    );
    expect(result.suppressed).toBe(false);
  });

  it("suppresses within the frequency cap window", () => {
    const result = evaluateSuppression(
      { hasActiveSuppression: false, unansweredCount60d: 0, lastRelayedAnyAt: daysAgo(5), now: NOW },
      config,
    );
    expect(result).toEqual({ suppressed: true, autoInsertTwoUnanswered: false });
  });

  it("clears once past the frequency cap window with no other suppression", () => {
    const result = evaluateSuppression(
      { hasActiveSuppression: false, unansweredCount60d: 0, lastRelayedAnyAt: daysAgo(11), now: NOW },
      config,
    );
    expect(result).toEqual({ suppressed: false, autoInsertTwoUnanswered: false });
  });

  it("is clear when there is no suppression, no unanswered history, and no prior relay", () => {
    const result = evaluateSuppression(
      { hasActiveSuppression: false, unansweredCount60d: 0, lastRelayedAnyAt: null, now: NOW },
      config,
    );
    expect(result).toEqual({ suppressed: false, autoInsertTwoUnanswered: false });
  });
});
