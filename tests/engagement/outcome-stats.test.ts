import { describe, expect, it } from "vitest";
import { computeOutcomeStats, type OutcomeStatsInputRow } from "@/lib/engagement/outcome-stats";

describe("computeOutcomeStats", () => {
  it("returns an empty array for no rows", () => {
    expect(computeOutcomeStats([])).toEqual([]);
  });

  it("groups rows by trigger type", () => {
    const rows: OutcomeStatsInputRow[] = [
      { triggerType: "breaking", evaluated: true, reorderedWithin7d: true, reorderedWithin14d: true, daysToReorder: 3 },
      { triggerType: "lapsed", evaluated: true, reorderedWithin7d: false, reorderedWithin14d: false, daysToReorder: null },
    ];
    const result = computeOutcomeStats(rows);
    expect(result.map((r) => r.triggerType)).toEqual(["lapsed", "breaking"]); // lapsed sorts before breaking
    expect(result.every((r) => r.relayedCount === 1)).toBe(true);
  });

  it("splits evaluated vs pending", () => {
    const rows: OutcomeStatsInputRow[] = [
      { triggerType: "breaking", evaluated: true, reorderedWithin7d: true, reorderedWithin14d: true, daysToReorder: 2 },
      { triggerType: "breaking", evaluated: false, reorderedWithin7d: null, reorderedWithin14d: null, daysToReorder: null },
      { triggerType: "breaking", evaluated: false, reorderedWithin7d: null, reorderedWithin14d: null, daysToReorder: null },
    ];
    const [result] = computeOutcomeStats(rows);
    expect(result.relayedCount).toBe(3);
    expect(result.evaluatedCount).toBe(1);
    expect(result.pendingCount).toBe(2);
  });

  it("computes reorder rates as a fraction of evaluated, not relayed, count", () => {
    const rows: OutcomeStatsInputRow[] = [
      { triggerType: "breaking", evaluated: true, reorderedWithin7d: true, reorderedWithin14d: true, daysToReorder: 3 },
      { triggerType: "breaking", evaluated: true, reorderedWithin7d: false, reorderedWithin14d: true, daysToReorder: 10 },
      { triggerType: "breaking", evaluated: false, reorderedWithin7d: null, reorderedWithin14d: null, daysToReorder: null },
    ];
    const [result] = computeOutcomeStats(rows);
    // 1 of 2 evaluated reordered within 7d, 2 of 2 within 14d -- the
    // pending row must not dilute either denominator.
    expect(result.reorderedWithin7dRate).toBe(0.5);
    expect(result.reorderedWithin14dRate).toBe(1);
  });

  it("returns null rates instead of NaN when nothing has been evaluated yet", () => {
    const rows: OutcomeStatsInputRow[] = [
      { triggerType: "breaking", evaluated: false, reorderedWithin7d: null, reorderedWithin14d: null, daysToReorder: null },
    ];
    const [result] = computeOutcomeStats(rows);
    expect(result.reorderedWithin7dRate).toBeNull();
    expect(result.reorderedWithin14dRate).toBeNull();
    expect(result.avgDaysToReorder).toBeNull();
  });

  it("averages days-to-reorder only over rows that actually reordered", () => {
    const rows: OutcomeStatsInputRow[] = [
      { triggerType: "breaking", evaluated: true, reorderedWithin7d: true, reorderedWithin14d: true, daysToReorder: 2 },
      { triggerType: "breaking", evaluated: true, reorderedWithin7d: true, reorderedWithin14d: true, daysToReorder: 6 },
      { triggerType: "breaking", evaluated: true, reorderedWithin7d: false, reorderedWithin14d: false, daysToReorder: null },
    ];
    const [result] = computeOutcomeStats(rows);
    expect(result.avgDaysToReorder).toBe(4);
  });

  it("sorts an unrecognised trigger type after the known ones, alphabetically", () => {
    const rows: OutcomeStatsInputRow[] = [
      { triggerType: "zzz_unknown", evaluated: false, reorderedWithin7d: null, reorderedWithin14d: null, daysToReorder: null },
      { triggerType: "drifting", evaluated: false, reorderedWithin7d: null, reorderedWithin14d: null, daysToReorder: null },
    ];
    const result = computeOutcomeStats(rows);
    expect(result.map((r) => r.triggerType)).toEqual(["drifting", "zzz_unknown"]);
  });
});
