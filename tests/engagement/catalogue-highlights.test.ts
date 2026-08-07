import { describe, expect, it } from "vitest";
import { pickHighlights } from "@/lib/engagement/catalogue-highlights";

describe("pickHighlights", () => {
  it("sorts alphabetically", () => {
    expect(pickHighlights(["Pomegranate", "Chausa Mango", "Muscat Grapes"], 5)).toEqual([
      "Chausa Mango",
      "Muscat Grapes",
      "Pomegranate",
    ]);
  });

  it("caps at the given limit", () => {
    expect(pickHighlights(["A", "B", "C", "D"], 2)).toEqual(["A", "B"]);
  });

  it("dedupes repeated names", () => {
    expect(pickHighlights(["Pomegranate", "Pomegranate", "Chausa Mango"], 5)).toEqual([
      "Chausa Mango",
      "Pomegranate",
    ]);
  });

  it("returns an empty array for no names", () => {
    expect(pickHighlights([], 5)).toEqual([]);
  });
});
