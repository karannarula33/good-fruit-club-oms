import { describe, expect, it } from "vitest";
import { summarizePackaging } from "@/lib/packing/packaging";

describe("summarizePackaging", () => {
  it("returns an empty string for no packages", () => {
    expect(summarizePackaging([])).toBe("");
  });

  it("counts a single package with singular label", () => {
    expect(summarizePackaging([{ packagingType: "big_box" }])).toBe("1 Big Box");
  });

  it("groups and pluralizes multiple of the same type", () => {
    expect(
      summarizePackaging([{ packagingType: "small_packet" }, { packagingType: "small_packet" }]),
    ).toBe("2 Small Packets");
  });

  it("orders groups by the fixed packaging-type order, not input order", () => {
    expect(
      summarizePackaging([
        { packagingType: "tiny_box" },
        { packagingType: "big_box" },
        { packagingType: "big_box" },
      ]),
    ).toBe("2 Big Boxes, 1 Tiny Box");
  });
});
