import { describe, expect, it } from "vitest";
import { computePackagingCost } from "@/lib/delivery/packaging-cost";
import type { PackagingType } from "@/lib/supabase/database.types";

const RATES: Record<PackagingType, number> = {
  big_box: 13,
  medium_box: 11,
  small_box: 9,
  small_packet: 6,
  medium_packet: 7,
  big_packet: 8,
  tiny_box: 9,
};

describe("computePackagingCost", () => {
  it("sums each package's rate plus the misc cost per package", () => {
    const total = computePackagingCost([{ packagingType: "big_box" }, { packagingType: "small_packet" }], RATES, 2);
    expect(total).toBe(13 + 2 + (6 + 2));
  });

  it("is zero with no packages used", () => {
    expect(computePackagingCost([], RATES, 2)).toBe(0);
  });

  it("adds the misc cost once per package, not once per order", () => {
    const total = computePackagingCost(
      [{ packagingType: "tiny_box" }, { packagingType: "tiny_box" }, { packagingType: "tiny_box" }],
      RATES,
      2,
    );
    expect(total).toBe(3 * (9 + 2));
  });
});
