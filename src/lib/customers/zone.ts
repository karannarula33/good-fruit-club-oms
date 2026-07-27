// Fixed delivery zone priority per CLAUDE.md §6. Order matters -- it's the
// route order delivery staff work through. "Unassigned" is a sentinel for
// addresses that couldn't be matched to a real zone (see 0004_customers.sql)
// and must never be treated as a real route stop, so it deliberately isn't
// part of ZONE_ORDER.

export const ZONE_ORDER = [
  "DLF Phase 2",
  "Sushant Lok",
  "Near Hamilton Court",
  "DLF Phase 1",
  "Phase 3",
  "Phase 4",
  "Phase 5",
  "Outside Gurgaon",
] as const;

export type RealZone = (typeof ZONE_ORDER)[number];
export type Zone = RealZone | "Unassigned";

const ZONE_PATTERNS: [RegExp, RealZone][] = [
  [/heritage city|the vilas|dlf[\s-]*phase[\s-]*2\b|dlf[\s-]*2\b/, "DLF Phase 2"],
  [/sushant lok/, "Sushant Lok"],
  [/hamilton court/, "Near Hamilton Court"],
  [/dlf[\s-]*phase[\s-]*1\b|dlf[\s-]*1\b|dlf[\s-]*i\b/, "DLF Phase 1"],
  [/dlf[\s-]*phase[\s-]*3\b|dlf[\s-]*3\b/, "Phase 3"],
  [/dlf[\s-]*phase[\s-]*4\b|dlf[\s-]*4\b/, "Phase 4"],
  [/dlf[\s-]*phase[\s-]*5\b|dlf[\s-]*5\b/, "Phase 5"],
];

export function deriveZoneFromAddress(address: string): Zone {
  const normalized = address.toLowerCase();
  for (const [pattern, zone] of ZONE_PATTERNS) {
    if (pattern.test(normalized)) return zone;
  }
  return "Unassigned";
}

export function zonePriority(zone: Zone): number {
  const index = ZONE_ORDER.indexOf(zone as RealZone);
  return index === -1 ? ZONE_ORDER.length : index;
}

export function compareByZone(a: Zone, b: Zone): number {
  return zonePriority(a) - zonePriority(b);
}
