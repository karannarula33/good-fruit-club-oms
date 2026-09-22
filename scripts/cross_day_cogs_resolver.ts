// Cross-day COGS resolver.
//
// Fills each still-uncosted live order_line (locked_cogs_per_unit = null, packed,
// actual_qty set) from the most-recent daily_cogs_entries for that product with
// entry_date <= the order's delivery_date -- the same "latest version <= date"
// model price_versions uses. This is the go-forward safety net for lines sold
// from STOCK (no same-day purchase), so their COGS falls back to the last price
// we actually paid for that product.
//
// Step 1 (--ingest): back-fill daily_cogs_entries from the local purchase records
//   (COGS/purchases/*.json) -- every buy line with a resolved product + unit_cost.
//   Never overwrites a manually-corrected entry unless --force. Dedupes to the
//   highest-confidence line per (date, product).
// Step 2: resolve uncosted live lines. Dry-run by default; --execute to write.
//
// Run: npm run cogs-resolver -- [--ingest] [--execute]

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createServiceRoleClient } from "../src/lib/supabase/service-role";

const PURCHASES_DIR = join(__dirname, "..", "COGS", "purchases");
const CONF_RANK: Record<string, number> = { high: 3, med: 2, low: 1 };

async function main() {
  const execute = process.argv.includes("--execute");
  const ingest = process.argv.includes("--ingest");
  const sb = createServiceRoleClient();

  const { data: products } = await sb.from("products").select("id, name");
  const { data: aliases } = await sb.from("product_aliases").select("alias, product_id");
  const idByName = new Map((products ?? []).map((p) => [p.name.toLowerCase(), p.id]));
  const idByAlias = new Map((aliases ?? []).map((a) => [a.alias.toLowerCase(), a.product_id]));
  const nameById = new Map((products ?? []).map((p) => [p.id, p.name]));
  const resolveProduct = (n: string | null) =>
    n ? idByName.get(n.trim().toLowerCase()) ?? idByAlias.get(n.trim().toLowerCase()) ?? null : null;

  // ---- Step 1: ingest purchase records into daily_cogs_entries ----
  if (ingest) {
    const best = new Map<string, { date: string; pid: string; cost: number; conf: number }>();
    for (const file of readdirSync(PURCHASES_DIR).filter((f) => f.endsWith(".json"))) {
      const doc = JSON.parse(readFileSync(join(PURCHASES_DIR, file), "utf-8"));
      for (const day of doc.days ?? []) {
        for (const line of day.lines ?? []) {
          const pid = resolveProduct(line.product);
          if (!pid || line.unit_cost == null || !Number.isFinite(line.unit_cost)) continue;
          const key = `${day.date}|${pid}`;
          const conf = CONF_RANK[line.confidence] ?? 0;
          const prev = best.get(key);
          if (!prev || conf > prev.conf) best.set(key, { date: day.date, pid, cost: line.unit_cost, conf });
        }
      }
    }
    const rows = [...best.values()].map((r) => ({ entry_date: r.date, product_id: r.pid, cost_per_unit: r.cost }));
    console.log(`Ingest: ${rows.length} (date,product) cost rows from purchase records.`);
    if (execute) {
      // chunked upsert
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await sb.from("daily_cogs_entries").upsert(rows.slice(i, i + 200), { onConflict: "entry_date,product_id" });
        if (error) throw new Error(`ingest upsert: ${error.message}`);
      }
      console.log(`  upserted ${rows.length} daily_cogs_entries rows.`);
    } else {
      console.log("  (dry run -- pass --execute to write)");
    }
  }

  // ---- build per-product price history ----
  const { data: entries } = await sb.from("daily_cogs_entries").select("entry_date, product_id, cost_per_unit").order("entry_date");
  const history = new Map<string, { date: string; cost: number }[]>();
  for (const e of entries ?? []) {
    if (!history.has(e.product_id)) history.set(e.product_id, []);
    history.get(e.product_id)!.push({ date: e.entry_date, cost: Number(e.cost_per_unit) });
  }
  const latestAtOrBefore = (pid: string, date: string): number | null => {
    const h = history.get(pid);
    if (!h) return null;
    let best: number | null = null;
    for (const row of h) { if (row.date <= date) best = row.cost; else break; }
    return best;
  };

  // ---- Step 2: resolve uncosted live lines ----
  // Fill both live and historical orders (historical sheet orders may lack COGS
  // where the sheet had none, e.g. the rebuilt Aug 4-26 range).
  // Paginate -- there are >1000 orders, past PostgREST's default page cap.
  const orders: { id: string; delivery_date: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("orders").select("id, delivery_date").range(from, from + 999);
    if (!data || data.length === 0) break;
    orders.push(...data);
    if (data.length < 1000) break;
  }
  const dateByOrder = new Map((orders ?? []).map((o) => [o.id, o.delivery_date]));
  const orderIds = (orders ?? []).map((o) => o.id);
  let uncosted: any[] = [];
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data: lines } = await sb.from("order_lines")
      .select("id, order_id, product_id, locked_cogs_per_unit, line_status, actual_qty")
      .in("order_id", orderIds.slice(i, i + 200));
    uncosted.push(...(lines ?? []).filter((l) => l.line_status !== "unavailable" && l.actual_qty != null && l.locked_cogs_per_unit == null));
  }

  let filled = 0;
  const stillBlank: string[] = [];
  for (const l of uncosted) {
    const date = dateByOrder.get(l.order_id)!;
    const cost = latestAtOrBefore(l.product_id, date);
    if (cost == null) { stillBlank.push(`${date} ${nameById.get(l.product_id)}`); continue; }
    console.log(`  fill ${date} ${nameById.get(l.product_id)} -> ${cost}`);
    if (execute) await sb.from("order_lines").update({ locked_cogs_per_unit: cost }).eq("id", l.id);
    filled++;
  }

  console.log(`\nResolver: ${uncosted.length} uncosted live lines | ${filled} fillable from history | ${stillBlank.length} still blank (no prior purchase).`);
  if (stillBlank.length) { console.log("  Still blank (need an earlier slip):"); [...new Set(stillBlank)].forEach((s) => console.log(`    ${s}`)); }
  if (!execute) console.log("\nDry run -- re-run with --execute to write.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
