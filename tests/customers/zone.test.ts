import { describe, expect, it } from "vitest";
import { compareByZone, deriveZoneFromAddress, zoneForArea, zoneHeaderLabel } from "@/lib/customers/zone";
import { nextZone } from "@/lib/customers/fill-areas";

describe("deriveZoneFromAddress", () => {
  it("keeps the original zones and their names", () => {
    expect(deriveZoneFromAddress("B 12/34, DLF Phase 2, Gurgaon")).toBe("DLF Phase 2");
    expect(deriveZoneFromAddress("Heritage City, Gurgaon")).toBe("DLF Phase 2");
    expect(deriveZoneFromAddress("Block C, Sushant Lok 1, Gurgaon")).toBe("Sushant Lok");
    expect(deriveZoneFromAddress("Tower 4, Hamilton Court, DLF City")).toBe("Near Hamilton Court");
    expect(deriveZoneFromAddress("7 Bodhi Marg, Near Arjun Marg, DLF-I, Gurgaon")).toBe("DLF Phase 1");
    expect(deriveZoneFromAddress("12, DLF Phase 3, Gurgaon")).toBe("Phase 3");
    expect(deriveZoneFromAddress("Magnolias, Golf Course Road, DLF Phase 5, Gurgaon")).toBe("Phase 5");
  });

  it("gives everyone else a new zone from their area", () => {
    expect(deriveZoneFromAddress("2nd floor, DLF City Phase-3")).toBe("Phase 3"); // area spelling, original zone
    expect(deriveZoneFromAddress("K1/601 Central Park 1, Sector 42, Gurgaon")).toBe("Sector 42");
    expect(deriveZoneFromAddress("Ambika Vihar, Paschim Vihar, New Delhi")).toBe("Paschim Vihar");
    expect(deriveZoneFromAddress("Flat 602")).toBe("Unassigned");
  });
});

describe("zoneForArea", () => {
  it("maps areas inside an original zone to that zone", () => {
    expect(zoneForArea("DLF Phase 4")).toBe("Phase 4");
    expect(zoneForArea("Sushant Lok 2")).toBe("Sushant Lok");
    expect(zoneForArea("DLF Phase 4", "Hamilton Court")).toBe("Near Hamilton Court");
    expect(zoneForArea("Lodhi Road")).toBe("Lodhi Road");
    expect(zoneForArea(null)).toBe("Unassigned");
  });
});

describe("nextZone", () => {
  it("never moves a customer out of an original zone", () => {
    expect(nextZone({ zone: "DLF Phase 2", area: null, locality: null }, { area: "Sector 42", locality: null })).toBe("DLF Phase 2");
    expect(nextZone({ zone: "Outside Gurgaon", area: null, locality: null }, { area: "Paschim Vihar", locality: null })).toBe("Outside Gurgaon");
    expect(nextZone({ zone: "Phase 3", area: "DLF Phase 3", locality: null }, { area: "Sector 42", locality: null })).toBe("Phase 3");
  });
  it("tags unassigned customers, and follows the area when the zone came from it", () => {
    expect(nextZone({ zone: "Unassigned", area: null, locality: null }, { area: "Paschim Vihar", locality: null })).toBe("Paschim Vihar");
    expect(nextZone({ zone: "Paschim Vihar", area: "Paschim Vihar", locality: null }, { area: "Rohini", locality: null })).toBe("Rohini");
    expect(nextZone({ zone: "Unassigned", area: null, locality: null }, null)).toBe("Unassigned");
  });
});

describe("route order", () => {
  it("keeps the original zone order, then new zones A-Z, then Unassigned", () => {
    const zones = ["Unassigned", "Paschim Vihar", "Phase 3", "Sector 42", "DLF Phase 2", "Outside Gurgaon", "Sushant Lok"];
    expect([...zones].sort(compareByZone)).toEqual(["DLF Phase 2", "Sushant Lok", "Phase 3", "Outside Gurgaon", "Paschim Vihar", "Sector 42", "Unassigned"]);
  });
  it("prints Hindi headers for the original zones", () => {
    expect(zoneHeaderLabel("Phase 3")).toBe("DLF Phase 3 — फेज़ 3");
    expect(zoneHeaderLabel("Paschim Vihar")).toBe("Paschim Vihar");
  });
});
