import { describe, expect, it } from "vitest";
import { canonicalArea, matchArea } from "@/lib/customers/area";

const area = (a: string) => matchArea(a)?.area ?? null;

describe("matchArea: Gurgaon spellings", () => {
  it.each([
    ["H-12, DLF Phase 2, Gurgaon", "DLF Phase 2"],
    ["2nd floor, dlf2", "DLF Phase 2"],
    ["GF, DLF City Phase-2", "DLF Phase 2"],
    ["DLF Ph-2, ground floor", "DLF Phase 2"],
    ["3rd floor, dlf-2", "DLF Phase 2"],
    ["near arjun marg, DLF-I", "DLF Phase 1"],
    ["dlf 1, sec 26", "DLF Phase 1"],
    ["3/5, DLF phase3", "DLF Phase 3"],
    ["DLF Phase 4 (near galleria market)", "DLF Phase 4"],
    ["flat 274, DLF Phase 5", "DLF Phase 5"],
    ["Sushant Lok Phase -1, sector 28", "Sushant Lok 1"],
    ["Sushant Lok 2, New Sushant Tower", "Sushant Lok 2"],
    ["block A, Sushant Lok", "Sushant Lok 1"],
    ["Sec-58, Golf Course Ext Road", "Golf Course Extension Road"],
    ["Gold course road, DLF Phase 5", "DLF Phase 5"],
    ["2nd floor, Palam Vihar", "Palam Vihar"],
  ])("%s -> %s", (input, expected) => {
    expect(area(input)).toBe(expected);
  });

  it("uses known societies, keeping them as the locality", () => {
    expect(matchArea("Tower 3, Heritage City, near MG Road metro")).toEqual({ city: "Gurgaon", area: "DLF Phase 2", locality: "Heritage City" });
    expect(matchArea("MGF The Vilas")).toEqual({ city: "Gurgaon", area: "DLF Phase 2", locality: "The Vilas" });
    expect(matchArea("Emaar Emerald Hills, Sector 65")?.area).toBe("Sector 65");
    expect(matchArea("12, Lagoon Apartments behind Ambience Mall, Gurgaon")).toEqual({ city: "Gurgaon", area: "Ambience Island", locality: "Ambience Lagoon" });
    expect(matchArea("The Grove, 4, Park Drive, Gurugram 122002")?.area).toBe("DLF Phase 5");
    expect(matchArea("Tower 6-1201, Malibu Towne Group Housing, Sector 47, Gurgaon 122018")?.locality).toBe("Malibu Towne");
  });

  it("falls back to the sector only in Gurgaon", () => {
    expect(matchArea("House 12, Sector 40, Gurgaon")).toEqual({ city: "Gurgaon", area: "Sector 40", locality: null });
    expect(matchArea("Second floor, sector 14, 122001")?.area).toBe("Sector 14");
    expect(matchArea("C-12, Sector 62, Noida 201301")).toBeNull(); // Noida sectors go to Claude
  });

  it("does not read 'DLF' words as phases", () => {
    expect(area("DLF IT Park")).toBeNull();
    expect(area("Ivy apartments")).toBeNull();
  });
});

describe("matchArea: Delhi", () => {
  it.each([
    ["Ambika Vihar, Paschim Vihar", "Paschim Vihar"],
    ["Lodhi Road, New Delhi", "Lodhi Road"],
    ["first floor, Greater Kailash 1", "Greater Kailash 1"],
    ["Greater Kailas 2", "Greater Kailash 2"],
    ["M block GK-1", "Greater Kailash 1"],
    ["C-8/8683, Vasant Kunj, New Delhi 110070", "Vasant Kunj"],
    ["Jamia Nagar, Okhla", "Jamia Nagar"],
  ])("%s -> %s", (input, expected) => {
    expect(area(input)).toBe(expected);
    expect(matchArea(input)?.city).toBe("Delhi");
  });

  it("leaves addresses with no recognisable area to Claude", () => {
    expect(matchArea("Flat 602 (building/complex not confirmed)")).toBeNull();
    expect(matchArea("Near Pushpanjali Hospital")).toBeNull();
  });
});

describe("canonicalArea", () => {
  it("brings free-text names to one spelling", () => {
    expect(canonicalArea("dlf city phase-2")).toBe("DLF Phase 2");
    expect(canonicalArea("Sec 65")).toBe("Sector 65");
    expect(canonicalArea("greater kailash-1")).toBe("Greater Kailash 1");
    expect(canonicalArea("mayur vihar phase 1")).toBe("Mayur Vihar Phase 1");
    expect(canonicalArea("  ")).toBeNull();
    expect(canonicalArea(null)).toBeNull();
  });
});
