// Delivery zones (CLAUDE.md §6). The original zones stay exactly as they
// were -- "DLF Phase 2", "Sushant Lok", "Near Hamilton Court", "DLF Phase 1",
// "Phase 3", "Phase 4", "Phase 5", "Outside Gurgaon" -- and customers already
// in one keep it. Since 2026-10-28, a customer with no zone ("Unassigned")
// gets one from their area (customers.area, read from the address, see
// area.ts): the matching original zone where there is one (DLF Phase 3 ->
// "Phase 3", Sushant Lok 1 -> "Sushant Lok"), otherwise a new zone named
// after the area ("Paschim Vihar", "Sector 65", "Golf Course Road"...).
//
// Route order: the original zones first in their fixed order, then every new
// zone A-Z, then "Unassigned".

import { matchArea } from "./area";

export type Zone = string;
export const UNASSIGNED_ZONE = "Unassigned";

export const ZONE_ORDER: readonly string[] = [
  "DLF Phase 2",
  "Sushant Lok",
  "Near Hamilton Court",
  "DLF Phase 1",
  "Phase 3",
  "Phase 4",
  "Phase 5",
  "Outside Gurgaon",
];

// The original address rules, unchanged: they decide the zone wherever they
// match, so existing customers and their spelling stay as before.
const ZONE_PATTERNS: [RegExp, string][] = [
  [/heritage city|the vilas|dlf[\s-]*phase[\s-]*2\b|dlf[\s-]*2\b/, "DLF Phase 2"],
  [/sushant lok/, "Sushant Lok"],
  [/hamilton court/, "Near Hamilton Court"],
  [/dlf[\s-]*phase[\s-]*1\b|dlf[\s-]*1\b|dlf[\s-]*i\b/, "DLF Phase 1"],
  [/dlf[\s-]*phase[\s-]*3\b|dlf[\s-]*3\b/, "Phase 3"],
  [/dlf[\s-]*phase[\s-]*4\b|dlf[\s-]*4\b/, "Phase 4"],
  [/dlf[\s-]*phase[\s-]*5\b|dlf[\s-]*5\b/, "Phase 5"],
];

// Areas that fall inside an original zone.
const AREA_TO_ZONE: Record<string, string> = {
  "DLF Phase 1": "DLF Phase 1",
  "DLF Phase 2": "DLF Phase 2",
  "DLF Phase 3": "Phase 3",
  "DLF Phase 4": "Phase 4",
  "DLF Phase 5": "Phase 5",
  "Sushant Lok 1": "Sushant Lok",
  "Sushant Lok 2": "Sushant Lok",
  "Sushant Lok 3": "Sushant Lok",
};

// The zone for an area read from the address.
export function zoneForArea(area: string | null | undefined, locality?: string | null): Zone {
  if (locality === "Hamilton Court") return "Near Hamilton Court";
  if (!area) return UNASSIGNED_ZONE;
  return AREA_TO_ZONE[area] ?? area;
}

// Zone straight from an address: the original rules first, then the area
// rules. Used for new customers and previews; the nightly area read (Claude
// fallback, fill-areas.ts) fills in any that stay Unassigned here.
export function deriveZoneFromAddress(address: string): Zone {
  const t = address.toLowerCase();
  for (const [re, zone] of ZONE_PATTERNS) if (re.test(t)) return zone;
  const a = matchArea(address);
  return a ? zoneForArea(a.area, a.locality) : UNASSIGNED_ZONE;
}

export function zonePriority(zone: Zone): number {
  if (zone === UNASSIGNED_ZONE) return ZONE_ORDER.length + 1;
  const index = ZONE_ORDER.indexOf(zone);
  return index === -1 ? ZONE_ORDER.length : index;
}

export function compareByZone(a: Zone, b: Zone): number {
  return zonePriority(a) - zonePriority(b) || a.localeCompare(b);
}

// Printed delivery sheet headers: Hindi for the original zones (as before);
// new zones print by name.
const HEADER: Record<string, string> = {
  "DLF Phase 2": "DLF Phase 2 — फेज़ 2",
  "Sushant Lok": "Sushant Lok — सुशांत लोक",
  "Near Hamilton Court": "Near Hamilton Court — हैमिल्टन कोर्ट के पास",
  "DLF Phase 1": "DLF Phase 1 — फेज़ 1",
  "Phase 3": "DLF Phase 3 — फेज़ 3",
  "Phase 4": "DLF Phase 4 — फेज़ 4",
  "Phase 5": "DLF Phase 5 / Golf Course Road — फेज़ 5 / गोल्फ कोर्स रोड",
  "Outside Gurgaon": "Outside Gurgaon — गुड़गांव के बाहर",
  Unassigned: "Other / Ad-hoc Zones — अन्य क्षेत्र",
};

export function zoneHeaderLabel(zone: Zone): string {
  return HEADER[zone] ?? zone;
}
