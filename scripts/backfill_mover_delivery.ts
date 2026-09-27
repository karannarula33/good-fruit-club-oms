// Parses the vendor "Good Fruit Club - Orders" Mover sheet (per-date tabs of
// Gurgaon 3P delivery charges) into per-day mover-cost JSON the delivery-cost
// applier consumes: COGS/delivery/mover/<YYYY-MM-DD>.json = [{customer, cost}].
//
// cost = that order's "Total Delivery Cost" column * 1.18 (18% GST, per admin).
//
// Name resolution (a sheet row is keyed only by a Plus Code on most tabs):
//   - Sep 22+ tabs carry "Customer Name" -> used directly.
//   - A Plus Code -> name dictionary is built from (a) every named sheet row and
//     (b) the WhatsApp location export Delivery/chat.md ("Name : <plus code>").
//   - Plus codes are matched on a COARSE grid (4 chars + "+" + first 2) so minor
//     precision differences (F3JJ+R7 vs F3JJ+R7G) still join; the leading global
//     "7JWV" area prefix is stripped.
//   - Each candidate name is validated against the OMS orders actually delivered
//     that date; the day's order set disambiguates when a code has >1 candidate.
//   - Rows still unresolved go to COGS/delivery/_unresolved.md with that day's
//     unmatched OMS customers as candidates, for manual mapping.
//
// Run: npm run backfill-mover-delivery -- <raw-sheet-json-path> [chat-md-path]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { createServiceRoleClient } from "../src/lib/supabase/service-role";

const OUT_DIR = join(__dirname, "..", "COGS", "delivery");
const MOVER_DIR = join(OUT_DIR, "mover");
const GST = 1.18;

const cell = (v: any): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("result" in v) return String(v.result ?? "");
    if ("text" in v) return String(v.text ?? "");
    if ("richText" in v) return (v.richText as any[]).map((r) => r.text).join("");
    return "";
  }
  return String(v).trim();
};
const round2 = (n: number) => Math.round(n * 100) / 100;

// Plus-code normalisation: strip whitespace + leading global area prefix (7JWV),
// uppercase. `full` keeps the exact code; `coarse` reduces to a ~14m grid key
// (<4 chars>+<first 2 after +>) so minor precision differences still join.
function full(raw: string): string {
  const s = raw.replace(/\s+/g, "").toUpperCase().replace(/^7JWV/, "");
  return s.includes("+") ? s : "";
}
function coarse(raw: string): string {
  const s = full(raw);
  const i = s.indexOf("+");
  return i < 0 ? "" : s.slice(0, i) + "+" + s.slice(i + 1, i + 3);
}
// Decode an Open Location Code (plus code) to a lat/lng centroid. Sheet/chat use
// LOCAL Gurgaon codes (e.g. "F3QM+HQ"); prepend the "7JWV" area prefix to get the
// full code, then decode the pair digits. Offline + deterministic.
const OLC_ALPH = "23456789CFGHJMPQRVWX";
function decodePlus(raw: string): { lat: number; lng: number } | null {
  let code = raw.replace(/\s+/g, "").toUpperCase();
  if (!code.includes("+")) return null;
  if (!code.startsWith("7JWV")) code = "7JWV" + code;
  code = code.replace("+", "");
  if (!/^[2-9CFGHJMPQRVWX]+$/.test(code)) return null;
  let lat = -90, lng = -180, res = 20;
  const n = Math.min(code.length, 10);
  for (let i = 0; i < n; i += 2) {
    lat += OLC_ALPH.indexOf(code[i]) * res;
    lng += OLC_ALPH.indexOf(code[i + 1]) * res;
    if (i < n - 2) res /= 20;
  }
  return { lat: lat + res / 2, lng: lng + res / 2 };
}
function metersApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (a.lat - b.lat) * 111320;
  const dLng = (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

// Match a candidate label to a canonical OMS name: exact, or every candidate
// token is a prefix of a distinct token of the OMS name (handles "Anand" ->
// "Anand Kumar", "Vikash Bhag" -> "Vikash Bhagchandka").
function tokPrefix(xt: string[], yt: string[]): boolean {
  const used = new Array(yt.length).fill(false);
  return xt.every((t) => {
    const i = yt.findIndex((n, j) => !used[j] && n.startsWith(t));
    if (i < 0) return false;
    used[i] = true;
    return true;
  });
}
function nameMatches(cand: string, omsName: string): boolean {
  const ct = cand.toLowerCase().split(/\s+/).filter(Boolean);
  const nt = omsName.toLowerCase().split(/\s+/).filter(Boolean);
  if (!ct.length || !nt.length) return false;
  if (ct.join(" ") === nt.join(" ")) return true;
  // either name's tokens prefix-match a distinct token of the other -- handles
  // "Anand" vs "Anand Kumar" AND "Col Satish Narula" vs "Satish Narula".
  return tokPrefix(ct, nt) || tokPrefix(nt, ct);
}
// atomic candidate names from a chat label like "Suroor / Annu Sethi (Sachin)"
function atomize(name: string): string[] {
  const out = new Set<string>();
  const cleaned = name.replace(/gurugram|gurgaon|haryana/gi, "").trim();
  for (const part of cleaned.split("/")) {
    const p = part.trim();
    if (p) out.add(p.replace(/\(.*?\)/g, "").trim());
    const paren = p.match(/\(([^)]+)\)/);
    if (paren) out.add(paren[1].trim());
  }
  return [...out].filter(Boolean);
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
function tabToDate(name: string): string | null {
  const m = name.toLowerCase().match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)/);
  if (!m) return null;
  const mon = MONTHS[m[2].slice(0, 3)];
  return mon ? `2026-${mon}-${m[1].padStart(2, "0")}` : null;
}

// Build coarse-plus -> set of candidate names from the WhatsApp export.
const PLUS_RE = /((?:7JWV)?[2-9CFGHJMPQRVWX]{4}\+[2-9CFGHJMPQRVWX]{2,3})/i;
interface PlusDict { full: Map<string, Set<string>>; coarse: Map<string, Set<string>>; }
function addToDict(dict: PlusDict, code: string, name: string) {
  const f = full(code), c = coarse(code);
  if (!c) return;
  for (const key of [["full", f] as const, ["coarse", c] as const]) {
    if (!key[1]) continue;
    const m = dict[key[0]];
    const set = m.get(key[1]) ?? m.set(key[1], new Set()).get(key[1])!;
    for (const n of atomize(name)) set.add(n);
  }
}
function parseChat(path: string): PlusDict {
  const dict: PlusDict = { full: new Map(), coarse: new Map() };
  const add = (code: string, name: string) => addToDict(dict, code, name);
  const lines = readFileSync(path, "utf-8").split("\n");
  let prevName = "";
  for (const raw of lines) {
    // strip "[HH:MM] ", "**Speaker:**", markdown quote markers
    let s = raw.replace(/^\s*\[\d{1,2}:\d{2}\]\s*/, "").replace(/\*\*[^*]+:\*\*/g, "").replace(/^>\s*_.*_$/, "").replace(/^#+\s.*/, "").trim();
    if (!s) continue;
    const m = s.match(PLUS_RE);
    if (m) {
      const before = s.slice(0, m.index).replace(/[:\-]\s*$/, "").trim();
      const nameText = before || prevName;
      if (nameText) add(m[1], nameText);
      if (before) prevName = before;
    } else {
      // a bare name line (e.g. "NK Mehndiratta") preceding a code-only next line
      if (/[a-z]/i.test(s) && !/http|maps|created the group|encrypted|changed the group|\d{2}\.\d+/.test(s)) {
        prevName = s.replace(/[:\-]\s*$/, "").trim();
      }
    }
  }
  return dict;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const rawPath = args[0];
  const chatPath = args[1] ?? join(__dirname, "..", "Delivery", "chat.md");
  if (!rawPath) { console.error("Usage: npm run backfill-mover-delivery -- <raw-sheet-json-path> [chat-md-path]"); process.exit(1); }

  const doc = JSON.parse(readFileSync(rawPath, "utf-8"));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(doc.content, "base64") as unknown as ExcelJS.Buffer);

  // 1. Parse every date tab into rows.
  interface SheetRow { date: string; orderNum: string; plus: string; name: string; cost: number; dist: string; weight: string; cod: string; }
  const rows: SheetRow[] = [];
  wb.eachSheet((ws) => {
    if (ws.name.toLowerCase().includes("payment")) return;
    const date = tabToDate(ws.name);
    if (!date) return;
    const header = (ws.getRow(1).values as any[]).map(cell);
    const find = (pred: (h: string) => boolean) => header.findIndex((h) => h && pred(h.toLowerCase()));
    const nameCol = find((h) => h.includes("customer name"));
    const plusCol = find((h) => h.includes("plus code"));
    const costCol = find((h) => h.includes("total delivery cost"));
    const ordCol = find((h) => h.includes("order #") || h.includes("order number") || h.includes("order id"));
    const distCol = find((h) => h.includes("distance"));
    const weightCol = find((h) => h.includes("weight"));
    const codCol = find((h) => h.includes("cod amount") || h.includes("cash collected") || h.includes("order amount"));
    if (costCol < 0) return;
    for (let r = 2; r <= ws.rowCount; r++) {
      const v = (ws.getRow(r).values as any[]).map(cell);
      const costRaw = v[costCol] ?? "";
      if (!costRaw || isNaN(Number(costRaw))) continue;
      const plus = plusCol >= 0 ? (v[plusCol] ?? "") : "";
      const name = nameCol >= 0 ? (v[nameCol] ?? "").trim() : "";
      const footer = /total|remittance|subtotal|gst/i;
      const hasPlus = plus.includes("+");
      const hasName = !!name && !footer.test(name);
      if (!hasPlus && !hasName) continue;
      rows.push({
        date, orderNum: ordCol >= 0 ? v[ordCol] ?? "" : "", plus, name, cost: Number(costRaw),
        dist: distCol >= 0 ? v[distCol] ?? "" : "", weight: weightCol >= 0 ? v[weightCol] ?? "" : "",
        cod: codCol >= 0 ? v[codCol] ?? "" : "",
      });
    }
  });

  // 2. Plus -> candidate names, from the chat export + every named sheet row.
  const dict: PlusDict = existsSync(chatPath) ? parseChat(chatPath) : { full: new Map(), coarse: new Map() };
  const chatCodes = dict.coarse.size;
  for (const r of rows) if (r.name && r.plus) addToDict(dict, r.plus, r.name);

  // Manual overrides (admin-confirmed from the resolve-tail worksheet) take top
  // priority. Keyed on the exact sheet row: date|orderNum|plus.
  const manualPath = join(OUT_DIR, "_manual_matches.json");
  const manual = new Map<string, string>();
  if (existsSync(manualPath)) {
    for (const m of JSON.parse(readFileSync(manualPath, "utf-8")) as any[])
      manual.set(`${m.date}|${m.orderNum}|${m.plus}`, m.customer);
  }
  const manualWarn: { date: string; customer: string }[] = [];

  // Geo index: decode every known full plus code to a point + its candidate
  // names, for distance-based fallback matching.
  const NEAR_M = Number(process.argv.find((a) => a.startsWith("--near="))?.slice(7)) || 120;
  const geo: { lat: number; lng: number; names: Set<string> }[] = [];
  for (const [code, names] of dict.full) { const p = decodePlus(code); if (p) geo.push({ ...p, names }); }

  // 3. OMS orders per delivery date (canonical names), for disambiguation + validation.
  const sb = createServiceRoleClient();
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const { data: omsData } = await sb
    .from("orders").select("delivery_date, bills(total), customers!inner(display_name, address, zone)")
    .in("delivery_date", dates).neq("status", "cancelled");
  const omsByDate = new Map<string, Set<string>>();
  // date -> (nameLower -> {name, address, total}) for the validation worksheet.
  const omsDetail = new Map<string, Map<string, { name: string; address: string; total: number | null }>>();
  const delhi = new Set<string>(); // customers delivered to in Delhi (never on the Gurgaon Mover sheet)
  const DELHI_RE = /new delhi|paschim vihar|greater kailash|punjabi bagh|nizamuddin|gulmohar|chanakyapuri|friends colony|kalkaji|ferozshah|derawal|\bdelhi\b|110\d{3}/i;
  const GGN_RE = /gurgaon|gurugram|haryana|122\d{3}/i;
  for (const o of (omsData ?? []) as any[]) {
    const name = o.customers.display_name;
    (omsByDate.get(o.delivery_date) ?? omsByDate.set(o.delivery_date, new Set()).get(o.delivery_date)!).add(name);
    const addr = o.customers.address ?? "";
    const total = Array.isArray(o.bills) && o.bills[0] ? Number(o.bills[0].total) : null;
    const dm = omsDetail.get(o.delivery_date) ?? omsDetail.set(o.delivery_date, new Map()).get(o.delivery_date)!;
    dm.set(name.toLowerCase(), { name, address: addr, total });
    if (o.customers.zone === "Outside Gurgaon" || (DELHI_RE.test(addr) && !GGN_RE.test(addr))) delhi.add(name.toLowerCase());
  }

  // 4. Resolve each row: pick the candidate name that matches an OMS order that day.
  mkdirSync(MOVER_DIR, { recursive: true });
  const unresolvedByDate = new Map<string, SheetRow[]>();
  const perDayResolved = new Map<string, { customer: string; cost: number }[]>();
  let totalRows = 0, resolvedRows = 0;

  for (const date of dates) {
    const dayRows = rows.filter((r) => r.date === date);
    const omsNames = [...(omsByDate.get(date) ?? [])];
    const resolved: { customer: string; cost: number }[] = [];
    const unresolved: SheetRow[] = [];
    // return the unique OMS name this candidate-set matches that day, or null.
    const resolveWith = (cands: Set<string>): string | null => {
      const hit = new Set<string>();
      for (const c of cands) for (const n of omsNames) if (nameMatches(c, n)) hit.add(n);
      return hit.size === 1 ? [...hit][0] : null;
    };
    for (const r of dayRows) {
      totalRows++;
      const cost = round2(r.cost * GST);
      // Manual override wins outright.
      const manualName = manual.get(`${r.date}|${r.orderNum}|${r.plus}`);
      if (manualName) {
        const canon = omsNames.find((n) => nameMatches(manualName, n));
        if (!canon) manualWarn.push({ date, customer: manualName });
        resolved.push({ customer: canon ?? manualName, cost });
        resolvedRows++;
        continue;
      }
      const direct = new Set<string>();
      if (r.name) for (const a of atomize(r.name)) direct.add(a);
      // Prefer the exact full plus code (breaks coarse-grid collisions between
      // two nearby customers); fall back to the coarse grid.
      const fullCands = new Set(direct);
      for (const n of dict.full.get(full(r.plus)) ?? []) fullCands.add(n);
      let match = resolveWith(fullCands);
      if (!match) {
        const coarseCands = new Set(direct);
        for (const n of dict.coarse.get(coarse(r.plus)) ?? []) coarseCands.add(n);
        match = resolveWith(coarseCands);
      }
      if (!match) {
        // Geographic fallback: nearest known customer location within NEAR_M metres.
        const rp = decodePlus(r.plus);
        if (rp) {
          const near = new Set<string>(direct);
          for (const g of geo) if (metersApart(rp, g) <= NEAR_M) for (const n of g.names) near.add(n);
          match = resolveWith(near);
        }
      }
      if (match) { resolved.push({ customer: match, cost }); resolvedRows++; }
      else unresolved.push(r);
    }
    // Forced singleton: mover sheet rows are all DB orders, so if exactly one
    // sheet row and one DB order are left unmatched, they must be each other.
    if (unresolved.length === 1) {
      const matchedSet = new Set(resolved.map((x) => x.customer.toLowerCase()));
      const residualDb = omsNames.filter((n) => !matchedSet.has(n.toLowerCase()) && !delhi.has(n.toLowerCase()));
      if (residualDb.length === 1) {
        const u = unresolved.pop()!;
        resolved.push({ customer: residualDb[0], cost: round2(u.cost * GST) });
        resolvedRows++;
      }
    }
    perDayResolved.set(date, resolved);
    if (unresolved.length) unresolvedByDate.set(date, unresolved);
    // A customer can have several Mover drops for one OMS order (multi-trip);
    // aggregate per customer so the per-order delivery cost is their day total.
    const agg = new Map<string, number>();
    for (const x of resolved) agg.set(x.customer, round2((agg.get(x.customer) ?? 0) + x.cost));
    writeFileSync(join(MOVER_DIR, `${date}.json`), JSON.stringify([...agg].map(([customer, cost]) => ({ customer, cost })), null, 2) + "\n");
  }

  // 5. Unresolved report (markdown + structured JSON) with candidate OMS
  // customers per day, for the resolve-the-tail worksheet.
  let md = "# Unresolved Mover-sheet rows (manual mapping needed)\n\nEach: sheet order# + plus code + cost (incl 18% GST) + Mover distance/weight/COD. Candidates = OMS deliveries that day not matched by another row (with address + bill total).\n\n";
  interface Candidate { name: string; address: string; total: number | null; }
  const jsonOut: {
    date: string; orderNum: string; plus: string; cost: number; mapsUrl: string;
    dist: string; weight: string; cod: string; candidates: Candidate[];
  }[] = [];
  for (const date of dates) {
    const un = unresolvedByDate.get(date);
    if (!un?.length) continue;
    const matched = new Set((perDayResolved.get(date) ?? []).map((r) => r.customer.toLowerCase()));
    const dm = omsDetail.get(date) ?? new Map();
    const candidates: Candidate[] = [...(omsByDate.get(date) ?? [])]
      .filter((n) => !matched.has(n.toLowerCase()))
      .map((n) => dm.get(n.toLowerCase()) ?? { name: n, address: "", total: null });
    md += `## ${date} (${un.length} unresolved)\nCandidates: ${candidates.map((c) => c.name).join(", ") || "(none)"}\n\n`;
    for (const u of un) {
      const cost = round2(u.cost * GST);
      md += `- order#${u.orderNum || "?"}  plus=${u.plus || "?"}  cost=${cost}  dist=${u.dist}  wt=${u.weight}  cod=${u.cod}\n`;
      const code = full(u.plus);
      const mapsUrl = code ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(code + " Gurugram")}` : "";
      jsonOut.push({ date, orderNum: u.orderNum, plus: u.plus, cost, mapsUrl, dist: u.dist, weight: u.weight, cod: u.cod, candidates });
    }
    md += "\n";
  }
  writeFileSync(join(OUT_DIR, "_unresolved.md"), md);
  writeFileSync(join(OUT_DIR, "_unresolved.json"), JSON.stringify(jsonOut, null, 2) + "\n");

  console.log(`Chat dict: ${chatCodes} coarse plus-codes from ${chatPath}`);
  console.log(`Parsed ${totalRows} order rows across ${dates.length} dates (${dates[0]} .. ${dates[dates.length - 1]}).`);
  console.log(`Resolved to an OMS order: ${resolvedRows} (${Math.round((resolvedRows / totalRows) * 100)}%). Unresolved: ${totalRows - resolvedRows}.`);
  console.log(`Manual overrides applied: ${manual.size}.`);
  if (manualWarn.length) {
    console.log(`  WARNING -- manual customer not found in OMS orders that day (verify before apply):`);
    manualWarn.forEach((w) => console.log(`    ${w.date}: "${w.customer}"`));
  }
  console.log(`Per-day mover JSON -> ${MOVER_DIR}/<date>.json ; tail -> ${join(OUT_DIR, "_unresolved.md")}\n`);
  for (const date of dates) {
    const res = perDayResolved.get(date)!.length;
    const un = unresolvedByDate.get(date)?.length ?? 0;
    console.log(`  ${date}: ${res} resolved${un ? `, ${un} unresolved` : ""}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
