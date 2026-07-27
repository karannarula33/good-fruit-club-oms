import { describe, expect, it } from "vitest";
import { compareByZone, deriveZoneFromAddress, ZONE_ORDER, type Zone } from "@/lib/customers/zone";

describe("deriveZoneFromAddress", () => {
  it("matches DLF Phase 2 including its aliases", () => {
    expect(deriveZoneFromAddress("B 12/34, DLF Phase 2, Gurgaon")).toBe("DLF Phase 2");
    expect(deriveZoneFromAddress("The Vilas, near central arcade, DLF-2")).toBe("DLF Phase 2");
    expect(deriveZoneFromAddress("Heritage City, Gurgaon")).toBe("DLF Phase 2");
    expect(deriveZoneFromAddress("C 4/12, DLF 2, Gurugram")).toBe("DLF Phase 2");
  });

  it("matches Sushant Lok", () => {
    expect(deriveZoneFromAddress("Block C, Sushant Lok 1, Gurgaon")).toBe("Sushant Lok");
  });

  it("matches Near Hamilton Court", () => {
    expect(deriveZoneFromAddress("Tower 4, Hamilton Court, DLF City")).toBe("Near Hamilton Court");
  });

  it("matches DLF Phase 1 including the roman-numeral spelling", () => {
    expect(deriveZoneFromAddress("A 21/1, DLF Phase 1, Gurgaon")).toBe("DLF Phase 1");
    expect(deriveZoneFromAddress("7 Bodhi Marg, Near Arjun Marg, DLF-I, Gurgaon")).toBe("DLF Phase 1");
  });

  it("matches Phase 3, 4, and 5", () => {
    expect(deriveZoneFromAddress("12, DLF Phase 3, Gurgaon")).toBe("Phase 3");
    expect(deriveZoneFromAddress("12, DLF-4, Gurgaon")).toBe("Phase 4");
    expect(deriveZoneFromAddress("Magnolias, Golf Course Road, DLF Phase 5, Gurgaon")).toBe("Phase 5");
  });

  it("falls back to Unassigned for addresses with no recognizable zone", () => {
    expect(deriveZoneFromAddress("K1/601 Central Park 1, Sector 42, Gurgaon")).toBe("Unassigned");
    expect(deriveZoneFromAddress("Golf Course Road, Gurgaon")).toBe("Unassigned");
  });

  it("is case-insensitive", () => {
    expect(deriveZoneFromAddress("dlf phase 2, gurgaon")).toBe("DLF Phase 2");
  });
});

describe("compareByZone", () => {
  it("orders zones per ZONE_ORDER", () => {
    const shuffled: (typeof ZONE_ORDER)[number][] = [
      "Outside Gurgaon",
      "DLF Phase 1",
      "DLF Phase 2",
      "Phase 5",
      "Sushant Lok",
    ];
    const sorted = [...shuffled].sort(compareByZone);
    expect(sorted).toEqual(["DLF Phase 2", "Sushant Lok", "DLF Phase 1", "Phase 5", "Outside Gurgaon"]);
  });

  it("sorts Unassigned after every real zone", () => {
    const shuffled: Zone[] = ["Unassigned", "Outside Gurgaon"];
    const sorted = [...shuffled].sort(compareByZone);
    expect(sorted).toEqual(["Outside Gurgaon", "Unassigned"]);
  });
});
