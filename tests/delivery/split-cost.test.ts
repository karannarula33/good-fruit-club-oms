import { describe, expect, it } from "vitest";
import { splitCostAcrossLines } from "@/lib/delivery/split-cost";

describe("splitCostAcrossLines", () => {
  it("divides the total evenly across lines", () => {
    expect(splitCostAcrossLines(100, 4)).toBe(25);
  });

  it("rounds to the nearest paisa", () => {
    expect(splitCostAcrossLines(100, 3)).toBe(33.33);
  });

  it("is zero for zero lines (no divide-by-zero)", () => {
    expect(splitCostAcrossLines(100, 0)).toBe(0);
  });
});
