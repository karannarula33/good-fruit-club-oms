// Where a customer actually is, read from their address (admin 2026-10-28):
// city -> area (neighbourhood) -> locality (society / building). For
// analysis only; the delivery ROUTE still uses the fixed `zone` (zone.ts).
//
// Resolution order (src/lib/customers/fill-areas.ts):
//   1. matchArea(): the rules below -- the common Gurgaon/Delhi spellings
//      ("dlf2", "DLF City Phase-2", "Ph-2", "gk-1", "sec 65"...) and well
//      known societies (Heritage City -> DLF Phase 2).
//   2. Claude (src/lib/parser/resolve-area.ts) for anything the rules can't
//      place, told to reuse the existing area names; its answer is then
//      passed through canonicalArea() so spellings stay consistent.
//   3. The admin can set it by hand on the customer page (area_source
//      'manual', never overwritten).

export const CITIES = ["Gurgaon", "Delhi", "Noida", "Faridabad", "Ghaziabad", "Other"] as const;
export type City = (typeof CITIES)[number];

export interface AreaResult {
  city: City;
  area: string | null; // null = the address doesn't say (e.g. only a flat number)
  locality: string | null;
}

// Societies / buildings that pin down the area on their own.
const LOCALITIES: [RegExp, string, string, City][] = [
  [/heritage city/, "Heritage City", "DLF Phase 2", "Gurgaon"],
  [/\bthe vilas\b|\bmgf vilas\b|\bvilas\b/, "The Vilas", "DLF Phase 2", "Gurgaon"],
  [/belvedere (tower|park)/, "Belvedere Towers", "DLF Phase 2", "Gurgaon"],
  [/beverly park/, "Beverly Park", "DLF Phase 2", "Gurgaon"],
  [/oakwood estate/, "Oakwood Estate", "DLF Phase 2", "Gurgaon"],
  [/regency park/, "Regency Park", "DLF Phase 4", "Gurgaon"],
  [/windsor court/, "Windsor Court", "DLF Phase 4", "Gurgaon"],
  [/pink town ?house/, "Pink Town House", "DLF Phase 3", "Gurgaon"],
  [/\bthe summit\b/, "The Summit", "DLF Phase 5", "Gurgaon"],
  [/park place/, "DLF Park Place", "DLF Phase 5", "Gurgaon"],
  [/emerald hills/, "Emerald Hills", "Sector 65", "Gurgaon"],
  [/raisina residency/, "Tata Raisina Residency", "Sector 59", "Gurgaon"],
  [/hamilton court/, "Hamilton Court", "DLF Phase 4", "Gurgaon"],
  [/parsvnath exotica/, "Parsvnath Exotica", "Golf Course Road", "Gurgaon"],
  [/malibu towne/, "Malibu Towne", "Sector 47", "Gurgaon"],
  [/(ambience )?lagoon/, "Ambience Lagoon", "Ambience Island", "Gurgaon"],
  [/(ambience )?caitriona/, "Ambience Caitriona", "Ambience Island", "Gurgaon"],
  [/the grove\b.*park drive|park drive.*the grove/, "The Grove", "DLF Phase 5", "Gurgaon"],
];

// Neighbourhoods. Order matters: the first match wins, so specific names
// come before the generic "Sector N" rule.
const AREAS: [RegExp, string, City][] = [
  [/dlf[\s-]*(city[\s-]*)?(phase|ph)?[\s.-]*(2|ii)\b/, "DLF Phase 2", "Gurgaon"],
  [/dlf[\s-]*(city[\s-]*)?(phase|ph)?[\s.-]*(1|i)\b/, "DLF Phase 1", "Gurgaon"],
  [/dlf[\s-]*(city[\s-]*)?(phase|ph)?[\s.-]*(3|iii)\b/, "DLF Phase 3", "Gurgaon"],
  [/dlf[\s-]*(city[\s-]*)?(phase|ph)?[\s.-]*(4|iv)\b/, "DLF Phase 4", "Gurgaon"],
  [/dlf[\s-]*(city[\s-]*)?(phase|ph)?[\s.-]*(5|v)\b/, "DLF Phase 5", "Gurgaon"],
  [/sushant[\s-]*lok[\s-]*(phase[\s-]*)?(1|i)\b/, "Sushant Lok 1", "Gurgaon"],
  [/sushant[\s-]*lok[\s-]*(phase[\s-]*)?(2|ii)\b/, "Sushant Lok 2", "Gurgaon"],
  [/sushant[\s-]*lok[\s-]*(phase[\s-]*)?(3|iii)\b/, "Sushant Lok 3", "Gurgaon"],
  [/sushant[\s-]*lok/, "Sushant Lok 1", "Gurgaon"],
  [/golf course (ext|extension)/, "Golf Course Extension Road", "Gurgaon"],
  [/g(o|ol)l?f course road|\bgcr\b/, "Golf Course Road", "Gurgaon"],
  [/south city[\s-]*(1|i)\b/, "South City 1", "Gurgaon"],
  [/south city[\s-]*(2|ii)\b/, "South City 2", "Gurgaon"],
  [/nirvana country/, "Nirvana Country", "Gurgaon"],
  [/palam vihar/, "Palam Vihar", "Gurgaon"],
  [/cyber ?city/, "DLF Cyber City", "Gurgaon"],
  [/qutub enclave/, "DLF Qutub Enclave", "Gurgaon"],
  [/sohna road/, "Sohna Road", "Gurgaon"],
  [/ambience (island|mall)/, "Ambience Island", "Gurgaon"],
  [/paschim vihar/, "Paschim Vihar", "Delhi"],
  [/lodh?i (road|colony|estate)/, "Lodhi Road", "Delhi"],
  [/greater kailas?h?[\s-]*(1|i)\b|\bgk[\s-]*(1|i)\b/, "Greater Kailash 1", "Delhi"],
  [/greater kailas?h?[\s-]*(2|ii)\b|\bgk[\s-]*(2|ii)\b/, "Greater Kailash 2", "Delhi"],
  [/vasant kunj/, "Vasant Kunj", "Delhi"],
  [/vasant vihar/, "Vasant Vihar", "Delhi"],
  [/jamia nagar/, "Jamia Nagar", "Delhi"],
  [/pitampura/, "Pitampura", "Delhi"],
  [/shivaji enclave/, "Shivaji Enclave", "Delhi"],
  [/derawal nagar/, "Derawal Nagar", "Delhi"],
  [/defen[cs]e colony/, "Defence Colony", "Delhi"],
  [/\bsaket\b/, "Saket", "Delhi"],
  [/hauz khas/, "Hauz Khas", "Delhi"],
  [/punjabi bagh/, "Punjabi Bagh", "Delhi"],
  [/rajouri garden/, "Rajouri Garden", "Delhi"],
  [/east of kailash/, "East of Kailash", "Delhi"],
  [/jor ?bagh/, "Jor Bagh", "Delhi"],
  [/golf links/, "Golf Links", "Delhi"],
  [/chanakya ?puri/, "Chanakyapuri", "Delhi"],
  [/safdarjung enclave/, "Safdarjung Enclave", "Delhi"],
  [/green park/, "Green Park", "Delhi"],
  [/panchsheel/, "Panchsheel Park", "Delhi"],
  [/sainik farm/, "Sainik Farms", "Delhi"],
  [/chattarpur|chhatarpur/, "Chhatarpur", "Delhi"],
  [/ghitorni/, "Ghitorni", "Delhi"],
];

const SECTOR = /\b(?:sector|sec)[\s.-]*(\d{1,3}[a-z]?)\b/;

function cityFromText(t: string): City | null {
  const pin = t.match(/\b(1[12]\d{4}|20[01]\d{3})\b/)?.[1];
  if (pin) {
    if (pin.startsWith("122")) return "Gurgaon";
    if (pin.startsWith("110")) return "Delhi";
    if (pin.startsWith("121")) return "Faridabad";
    if (pin.startsWith("2013")) return "Noida";
    if (pin.startsWith("2010")) return "Ghaziabad";
  }
  if (/gurgaon|gurugram/.test(t)) return "Gurgaon";
  if (/noida/.test(t)) return "Noida";
  if (/faridabad/.test(t)) return "Faridabad";
  if (/ghaziabad/.test(t)) return "Ghaziabad";
  if (/\bdelhi\b/.test(t)) return "Delhi";
  return null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

// Rules only. Returns null when the address needs a closer read (Claude).
export function matchArea(address: string): AreaResult | null {
  const t = norm(address);
  for (const [re, locality, area, city] of LOCALITIES) if (re.test(t)) return { city, area, locality };
  for (const [re, area, city] of AREAS) if (re.test(t)) return { city, area, locality: null };
  const city = cityFromText(t);
  const sector = t.match(SECTOR)?.[1];
  // "Sector N" alone only for Gurgaon (Noida has sectors too).
  if (sector && city === "Gurgaon") return { city, area: `Sector ${sector.toUpperCase()}`, locality: null };
  return null;
}

// Puts a free-text area name (e.g. from Claude) into our canonical spelling:
// "dlf city phase-2" -> "DLF Phase 2", "sec 65" -> "Sector 65"; otherwise
// tidies the casing.
export function canonicalArea(area: string | null | undefined): string | null {
  if (!area) return null;
  const t = norm(area).trim();
  if (!t) return null;
  for (const [re, name] of AREAS) if (re.test(t)) return name;
  for (const [re, , name] of LOCALITIES) if (re.test(t)) return name;
  const sector = t.match(new RegExp(`^${SECTOR.source}$`))?.[1];
  if (sector) return `Sector ${sector.toUpperCase()}`;
  return t
    .split(" ")
    .map((w) => (/^(dlf|gk|mg|nh|ii|iii|iv)$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function isCity(v: unknown): v is City {
  return typeof v === "string" && (CITIES as readonly string[]).includes(v);
}

// Every area name the rules know, for Claude to reuse.
export const KNOWN_AREAS: string[] = [...new Set([...AREAS.map(([, a]) => a), ...LOCALITIES.map(([, , a]) => a)])];
