// Backfills order_lines.actual_packaging_cost from the "Order Packaging per
// Delivery Sheets" workbook (per-order box counts as printed on each day's
// delivery sheet). For orders where packers never recorded order_packages
// (all historical, and live gaps).
//
// Per-order packaging cost = sum over box types of count * (box_cost + misc),
// using packaging_cost_config + finance_config.misc_cost_per_box. Split evenly
// across that order's sold lines. Fills nulls only (never overwrites the
// order_packages-derived cost live orders already have).
//
// Sheet codes -> config types: B=big_box, M=medium_box, T=tiny_box,
//   S=small_box, SP=small_packet, BP=big_packet. "Gift Hamper" -> big_box rate
//   (a hamper ships in a big box); flagged in output.
//
// Match: date + customer -> OMS order(s). A customer's total is split across
// all their sold lines that day (handles multi-order/same-day).
//
// Run: npm run apply-packaging-from-sheet -- <xlsx-path> [--execute]

import ExcelJS from "exceljs";
import { createServiceRoleClient } from "../src/lib/supabase/service-role";

const round2 = (n: number) => Math.round(n * 100) / 100;
function cell(v: any): string {
  if (v == null) return "";
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  if (typeof v === "object") return String(v.result ?? v.text ?? (v.richText ? v.richText.map((r: any) => r.text).join("") : ""));
  return String(v).trim();
}
function tokPrefix(xt: string[], yt: string[]): boolean {
  const used = new Array(yt.length).fill(false);
  return xt.every((t) => { const i = yt.findIndex((n, j) => !used[j] && n.startsWith(t)); if (i < 0) return false; used[i] = true; return true; });
}
function nameMatches(a: string, b: string): boolean {
  const at = a.toLowerCase().split(/\s+/).filter(Boolean), bt = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (!at.length || !bt.length) return false;
  if (at.join(" ") === bt.join(" ")) return true;
  return tokPrefix(at, bt) || tokPrefix(bt, at);
}
// split alias labels "Suroor / Annu Sethi", "Sachin Bansal (Anju)" into atoms
function atomize(name: string): string[] {
  const out = new Set<string>();
  const cleaned = name.replace(/gurugram|gurgaon|haryana/gi, "").trim();
  for (const part of cleaned.split("/")) {
    const p = part.trim();
    if (p) out.add(p.replace(/\(.*?\)/g, "").trim());
    const m = p.match(/\(([^)]+)\)/);
    if (m) out.add(m[1].trim());
  }
  return [...out].filter(Boolean);
}
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
// customer match tolerant of aliases + small spelling variants (Sawhney/Sawney,
// Prakash/Parkash). Validated against that day's OMS orders, so fuzz is safe.
function customerMatch(sheet: string, omsName: string): boolean {
  for (const sa of atomize(sheet)) for (const oa of atomize(omsName)) {
    if (nameMatches(sa, oa)) return true;
    if (Math.abs(sa.length - oa.length) <= 2 && lev(sa.toLowerCase(), oa.toLowerCase()) <= 2) return true;
  }
  return false;
}

// sheet column code -> config packaging_type
const CODE: Record<string, string> = { B: "big_box", M: "medium_box", T: "tiny_box", S: "small_box", SP: "small_packet", BP: "big_packet" };

// admin-confirmed name aliases (packaging-sheet label -> OMS customer)
const ALIAS: Record<string, string> = {
  "sunita gupta": "Pradeep Gupta",       // same household
  "vikas khosla": "Rahul Khosla",        // Rahul's order placed/paid by brother Vikas
};

async function main() {
  const execute = process.argv.includes("--execute");
  const xlsxPath = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!xlsxPath) { console.error("Usage: npm run apply-packaging-from-sheet -- <xlsx-path> [--execute] [--remap=OLD:NEW]"); process.exit(1); }
  // Some sheets are packing-dated (a batch packed the night before delivery).
  // --remap=2026-08-09:2026-08-10 maps a packing date to its OMS delivery date.
  const remap = new Map<string, string>();
  for (const a of process.argv) if (a.startsWith("--remap=")) { const [o, n] = a.slice(8).split(":"); if (o && n) remap.set(o, n); }
  const dkey = (d: string) => remap.get(d) ?? d;
  console.log(`Mode: ${execute ? "EXECUTE (will write)" : "DRY RUN (no writes)"}\n`);

  const sb = createServiceRoleClient();
  const [{ data: cfg }, { data: misc }] = await Promise.all([
    sb.from("packaging_cost_config").select("packaging_type, box_cost"),
    sb.from("finance_config").select("value").eq("key", "misc_cost_per_box").maybeSingle(),
  ]);
  const boxCost = new Map((cfg ?? []).map((c: any) => [c.packaging_type, Number(c.box_cost)]));
  const miscPerBox = misc ? Number(misc.value) : 0;
  const unitCost = (type: string) => (boxCost.get(type) ?? 0) + miscPerBox;

  // Parse the Orders tab -> per (date, customer) packaging cost.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const ws = wb.getWorksheet("Orders")!;
  const header = (ws.getRow(1).values as any[]).map(cell);
  const col = (label: string) => header.findIndex((h) => h && h.toLowerCase() === label.toLowerCase());
  const dateC = col("Date"), custC = col("Customer");
  const codeCols: [string, number][] = ["B", "M", "T", "S", "SP", "BP"].map((c) => [c, col(c)]);
  const giftC = header.findIndex((h) => h && h.toLowerCase().includes("gift"));

  interface Row { date: string; customer: string; cost: number; gift: number; }
  const rows: Row[] = [];
  let giftTotal = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const v = (ws.getRow(r).values as any[]).map(cell);
    const date = v[dateC], customer = (v[custC] ?? "").trim();
    if (!date || !customer || /total/i.test(customer)) continue;
    let cost = 0;
    for (const [code, ci] of codeCols) { const n = Number(v[ci]); if (Number.isFinite(n) && n > 0) cost += n * unitCost(CODE[code]); }
    const gift = giftC >= 0 ? Number(v[giftC]) || 0 : 0;
    if (gift > 0) { cost += gift * unitCost("big_box"); giftTotal += gift; }
    if (cost > 0) rows.push({ date, customer, cost: round2(cost), gift });
  }
  // aggregate per date+customer
  const byKey = new Map<string, { date: string; customer: string; cost: number }>();
  for (const r of rows) {
    const k = `${r.date}|${r.customer.toLowerCase()}`;
    const e = byKey.get(k) ?? { date: r.date, customer: r.customer, cost: 0 };
    e.cost = round2(e.cost + r.cost); byKey.set(k, e);
  }

  const dates = [...new Set([...byKey.values()].flatMap((r) => [r.date, dkey(r.date)]))].sort();
  console.log(`Parsed ${rows.length} order rows, ${byKey.size} date+customer groups, ${dates.length} dates (${dates[0]}..${dates[dates.length - 1]}). Gift Hamper units: ${giftTotal}.`);

  // OMS orders per date
  let from = 0; const oms: any[] = [];
  for (;;) { const { data } = await sb.from("orders").select("id, delivery_date, customers!inner(display_name), order_lines(id, actual_qty, line_status, actual_packaging_cost)").in("delivery_date", dates).neq("status", "cancelled").range(from, from + 999); if (!data || !data.length) break; oms.push(...data); if (data.length < 1000) break; from += 1000; }
  const omsByDate = new Map<string, any[]>();
  for (const o of oms) (omsByDate.get(o.delivery_date) ?? omsByDate.set(o.delivery_date, []).get(o.delivery_date)!).push(o);
  const soldLines = (o: any) => o.order_lines.filter((l: any) => l.line_status !== "unavailable" && (l.actual_qty ?? 0) > 0);

  const lineUpdates: { id: string; cost: number }[] = [];
  const unresolved: { date: string; customer: string; cost: number; reason: string }[] = [];
  let filled = 0, alreadySet = 0;
  for (const g of byKey.values()) {
    const dayOrders = omsByDate.get(dkey(g.date)) ?? [];
    const target = ALIAS[g.customer.toLowerCase()] ?? g.customer;
    const matches = dayOrders.filter((o) => customerMatch(target, o.customers.display_name));
    if (matches.length === 0) { unresolved.push({ ...g, reason: "no OMS order that date" }); continue; }
    const distinct = new Set(matches.map((o) => o.customers.display_name));
    if (distinct.size > 1) { unresolved.push({ ...g, reason: `ambiguous: matches ${[...distinct].join(" / ")}` }); continue; }
    const allSold = matches.flatMap((o) => soldLines(o));
    if (allSold.length === 0) { unresolved.push({ ...g, reason: "matched order(s) have no sold lines" }); continue; }
    const perLine = round2(g.cost / allSold.length);
    for (const l of allSold) { if (l.actual_packaging_cost === null) { lineUpdates.push({ id: l.id, cost: perLine }); filled++; } else alreadySet++; }
  }

  console.log(`\nWould fill ${filled} lines, ${alreadySet} already set (untouched). Unresolved groups: ${unresolved.length}`);
  unresolved.slice(0, 40).forEach((u) => console.log(`  ${u.date} "${u.customer}" (₹${u.cost}): ${u.reason}`));

  if (!execute) { console.log("\nDry run only. Re-run with --execute to write."); return; }

  const byCost = new Map<number, string[]>();
  for (const u of lineUpdates) byCost.set(u.cost, [...(byCost.get(u.cost) ?? []), u.id]);
  for (const [cost, ids] of byCost) {
    for (let i = 0; i < ids.length; i += 500) {
      const { error } = await sb.from("order_lines").update({ actual_packaging_cost: cost }).in("id", ids.slice(i, i + 500));
      if (error) throw new Error(`Failed updating at ${cost}: ${error.message}`);
    }
  }
  console.log(`\nApplied. ${filled} order_lines filled with packaging cost.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
