import { describe, expect, it } from "vitest";
import { evaluateNudgeOutcome } from "@/lib/engagement/outcomes";

const relayedAt = new Date("2026-08-01T09:00:00Z");

describe("evaluateNudgeOutcome", () => {
  it("marks no reorder when the customer has no orders at all", () => {
    const result = evaluateNudgeOutcome(relayedAt, []);
    expect(result).toEqual({
      reorderedWithin7d: false,
      reorderedWithin14d: false,
      reorderOrderId: null,
      daysToReorder: null,
    });
  });

  it("ignores orders placed before the nudge was relayed", () => {
    const result = evaluateNudgeOutcome(relayedAt, [{ id: "old", placedAt: new Date("2026-07-20T09:00:00Z") }]);
    expect(result.reorderOrderId).toBeNull();
  });

  it("ignores an order placed at exactly the relay instant (must be strictly after)", () => {
    const result = evaluateNudgeOutcome(relayedAt, [{ id: "same-instant", placedAt: relayedAt }]);
    expect(result.reorderOrderId).toBeNull();
  });

  it("counts a reorder 3 days later as within both windows", () => {
    const result = evaluateNudgeOutcome(relayedAt, [{ id: "o1", placedAt: new Date("2026-08-04T09:00:00Z") }]);
    expect(result).toEqual({
      reorderedWithin7d: true,
      reorderedWithin14d: true,
      reorderOrderId: "o1",
      daysToReorder: 3,
    });
  });

  it("treats exactly day 7 as within the 7-day window (boundary inclusive)", () => {
    const result = evaluateNudgeOutcome(relayedAt, [{ id: "o1", placedAt: new Date("2026-08-08T09:00:00Z") }]);
    expect(result.reorderedWithin7d).toBe(true);
    expect(result.daysToReorder).toBe(7);
  });

  it("treats day 8 as past the 7-day window but within the 14-day window", () => {
    const result = evaluateNudgeOutcome(relayedAt, [{ id: "o1", placedAt: new Date("2026-08-09T09:00:00Z") }]);
    expect(result.reorderedWithin7d).toBe(false);
    expect(result.reorderedWithin14d).toBe(true);
  });

  it("treats exactly day 14 as within the 14-day window (boundary inclusive)", () => {
    const result = evaluateNudgeOutcome(relayedAt, [{ id: "o1", placedAt: new Date("2026-08-15T09:00:00Z") }]);
    expect(result.reorderedWithin14d).toBe(true);
  });

  it("treats day 15 as past both windows -- still records the order, both flags false", () => {
    const result = evaluateNudgeOutcome(relayedAt, [{ id: "o1", placedAt: new Date("2026-08-16T09:00:00Z") }]);
    expect(result.reorderedWithin7d).toBe(false);
    expect(result.reorderedWithin14d).toBe(false);
    expect(result.reorderOrderId).toBe("o1");
    expect(result.daysToReorder).toBe(15);
  });

  it("picks the earliest post-relay order when several exist, ignoring later ones", () => {
    const result = evaluateNudgeOutcome(relayedAt, [
      { id: "later", placedAt: new Date("2026-08-10T09:00:00Z") },
      { id: "earliest", placedAt: new Date("2026-08-03T09:00:00Z") },
      { id: "before-relay", placedAt: new Date("2026-07-25T09:00:00Z") },
    ]);
    expect(result.reorderOrderId).toBe("earliest");
    expect(result.daysToReorder).toBe(2);
  });
});
