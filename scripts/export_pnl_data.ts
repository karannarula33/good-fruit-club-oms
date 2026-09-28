// Exports the full order + cost dataset to CSV files for analysis in a Claude
// chat (upload the files there). Combines DB per-line financials (revenue via
// bills.total, COGS/packaging/delivery/labour from order_lines) with the
// day-level and company costs that live only in local JSON (COD remittance,
// off-day Mover min-guarantees, newspaper ads, wage payments).
//
// Revenue source of truth = bills.total (bakes in tiers/overrides/gift-box
// pricing). Per-line revenue = actual_qty x rate is approximate for gift boxes
// (flagged is_gift_box) -- use orders.csv for true P&L revenue, order_lines.csv
// for product-level cost/margin detail.
//
// Internal customers (COGS/internal_customers.json) are excluded entirely.
// Cancelled orders are excluded. Output -> COGS/export/ (gitignored).
//
// Run: npm run export-pnl

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServiceRoleClient } from "../src/lib/supabase/service-role";

const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "COGS", "export");
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---- CSV helpers ----
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? String(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csv(rows: (unknown[])[]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}
function istDate(iso: string | null): string {
  if (!iso) return "";
  // YYYY-MM-DD in Asia/Kolkata
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// `run` returns a Supabase query builder (a thenable). Its resolved `data` is
// typed `unknown` here so callers can select columns not yet in the generated
// database.types.ts (e.g. actual_labour_cost, added in migration 0025 but not
// regenerated -- no Supabase CLI in this environment); we cast to T[] inside.
async function fetchAll<T>(run: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await run(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data as T[] | null) ?? [];
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const sb = createServiceRoleClient();

  const internalPath = join(ROOT, "COGS", "internal_customers.json");
  const internal = new Set<string>(existsSync(internalPath) ? (JSON.parse(readFileSync(internalPath, "utf-8")).customers ?? []).map((c: string) => c.toLowerCase()) : []);

  // ---- reference ----
  const { data: products } = await sb.from("products").select("id, name, unit_label");
  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const { data: customers } = await sb.from("customers").select("id, display_name, zone");
  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));

  // ---- orders (exclude cancelled) ----
  const orders = await fetchAll<{ id: string; customer_id: string; placed_at: string; delivery_date: string; status: string }>((f, t) =>
    sb.from("orders").select("id, customer_id, placed_at, delivery_date, status").neq("status", "cancelled").order("delivery_date").range(f, t),
  );
  const keptOrders = orders.filter((o) => !internal.has((customerById.get(o.customer_id)?.display_name ?? "").toLowerCase()));
  const orderById = new Map(keptOrders.map((o) => [o.id, o]));

  // ---- order_lines with cost columns ----
  const lines = await fetchAll<{ id: string; order_id: string; product_id: string | null; ordered_qty: number | null; ordered_unit: string | null; actual_qty: number | null; line_status: string; is_substitution: boolean; is_gift_box: boolean; locked_price_per_unit: number | null; locked_cogs_per_unit: number | null; actual_packaging_cost: number | null; actual_delivery_cost: number | null; actual_labour_cost: number | null }>((f, t) =>
    sb.from("order_lines").select("id, order_id, product_id, ordered_qty, ordered_unit, actual_qty, line_status, is_substitution, is_gift_box, locked_price_per_unit, locked_cogs_per_unit, actual_packaging_cost, actual_delivery_cost, actual_labour_cost").order("order_id").range(f, t),
  );

  // ---- bills + allocations ----
  const bills = await fetchAll<{ order_id: string; total: number; prev_balance: number; net_due: number }>((f, t) => sb.from("bills").select("order_id, total, prev_balance, net_due").range(f, t));
  const billByOrder = new Map(bills.map((b) => [b.order_id, b]));
  const allocs = await fetchAll<{ order_id: string; amount: number }>((f, t) => sb.from("payment_allocations").select("order_id, amount").range(f, t));
  const paidByOrder = new Map<string, number>();
  for (const a of allocs) paidByOrder.set(a.order_id, (paidByOrder.get(a.order_id) ?? 0) + Number(a.amount));

  // ---- build order_lines.csv + per-order cost sums ----
  const lineHeader = ["delivery_date", "placed_at_ist", "order_id", "customer", "zone", "order_status", "product", "unit_label", "ordered_qty", "ordered_unit", "actual_qty", "is_sold", "line_status", "is_substitution", "is_gift_box", "rate_per_unit", "line_revenue", "cogs_per_unit", "cogs", "packaging_cost", "delivery_cost", "labour_cost", "line_total_cost", "line_margin"];
  const lineRows: unknown[][] = [lineHeader];
  const sums = new Map<string, { cogs: number; pkg: number; del: number; lab: number }>();

  for (const l of lines) {
    const o = orderById.get(l.order_id);
    if (!o) continue; // cancelled or internal
    const c = customerById.get(o.customer_id);
    const p = l.product_id ? productById.get(l.product_id) : undefined;
    const sold = (l.actual_qty ?? 0) > 0 && l.line_status !== "unavailable";
    const qty = l.actual_qty ?? 0;
    const revenue = sold && l.locked_price_per_unit !== null ? round2(qty * l.locked_price_per_unit) : (sold ? "" : 0);
    const cogs = sold && l.locked_cogs_per_unit !== null ? round2(qty * l.locked_cogs_per_unit) : (sold ? "" : 0);
    const pkg = sold ? Number(l.actual_packaging_cost ?? 0) : 0;
    const del = sold ? Number(l.actual_delivery_cost ?? 0) : 0;
    const lab = sold ? Number(l.actual_labour_cost ?? 0) : 0;
    const totalCost = typeof cogs === "number" ? round2(cogs + pkg + del + lab) : "";
    const margin = typeof revenue === "number" && typeof totalCost === "number" ? round2(revenue - totalCost) : "";

    if (sold) {
      const s = sums.get(l.order_id) ?? { cogs: 0, pkg: 0, del: 0, lab: 0 };
      s.cogs += typeof cogs === "number" ? cogs : 0;
      s.pkg += pkg; s.del += del; s.lab += lab;
      sums.set(l.order_id, s);
    }

    lineRows.push([
      o.delivery_date, istDate(o.placed_at), o.id, c?.display_name ?? "", c?.zone ?? "", o.status,
      p?.name ?? (l.product_id ? "Unknown" : "(unmapped)"), p?.unit_label ?? "",
      l.ordered_qty ?? "", l.ordered_unit ?? "", l.actual_qty ?? "", sold ? "yes" : "no", l.line_status,
      l.is_substitution ? "yes" : "no", l.is_gift_box ? "yes" : "no",
      l.locked_price_per_unit ?? "", revenue, l.locked_cogs_per_unit ?? "", cogs, round2(pkg), round2(del), round2(lab), totalCost, margin,
    ]);
  }

  // ---- orders.csv (authoritative revenue via bills.total) ----
  const orderHeader = ["delivery_date", "placed_at_ist", "order_id", "customer", "zone", "status", "bill_total_revenue", "prev_balance", "net_due", "amount_paid", "payment_status", "cogs", "packaging_cost", "delivery_cost", "labour_cost", "total_cost", "gross_margin", "margin_pct"];
  const orderRows: unknown[][] = [orderHeader];
  let tRev = 0, tCogs = 0, tPkg = 0, tDel = 0, tLab = 0;
  for (const o of keptOrders) {
    const c = customerById.get(o.customer_id);
    const b = billByOrder.get(o.id);
    const rev = b ? Number(b.total) : "";
    const paid = paidByOrder.get(o.id) ?? 0;
    const s = sums.get(o.id) ?? { cogs: 0, pkg: 0, del: 0, lab: 0 };
    const totalCost = round2(s.cogs + s.pkg + s.del + s.lab);
    const margin = typeof rev === "number" ? round2(rev - totalCost) : "";
    const marginPct = typeof rev === "number" && rev > 0 ? round2((Number(margin) / rev) * 100) : "";
    const payStatus = b ? (paid >= Number(b.total) - 0.01 ? "paid" : paid > 0 ? "partial" : "unpaid") : "no_bill";
    if (typeof rev === "number") tRev += rev;
    tCogs += s.cogs; tPkg += s.pkg; tDel += s.del; tLab += s.lab;
    orderRows.push([o.delivery_date, istDate(o.placed_at), o.id, c?.display_name ?? "", c?.zone ?? "", o.status, rev, b?.prev_balance ?? "", b?.net_due ?? "", round2(paid), payStatus, round2(s.cogs), round2(s.pkg), round2(s.del), round2(s.lab), totalCost, margin, marginPct]);
  }

  // ---- daily_other_costs.csv (day-level, not in orders) ----
  const dailyHeader = ["date", "type", "amount", "note"];
  const dailyRows: unknown[][] = [dailyHeader];
  let tOther = 0;
  const codPath = join(ROOT, "COGS", "delivery", "cod_remittance.json");
  if (existsSync(codPath)) {
    const cod = JSON.parse(readFileSync(codPath, "utf-8"));
    for (const d of cod.days ?? []) {
      const inclGst = round2(Number(d.cod_remittance ?? 0) * 1.18);
      if (inclGst === 0) continue;
      dailyRows.push([d.date, "cod_remittance_incl_gst", inclGst, "COD/reverse-COD handover fee (18% GST added)"]);
      tOther += inclGst;
    }
  }
  const extrasPath = join(ROOT, "COGS", "delivery", "daily_pl_extras.json");
  if (existsSync(extrasPath)) {
    const ex = JSON.parse(readFileSync(extrasPath, "utf-8"));
    for (const d of ex.days ?? []) {
      if (Number(d.mover_min_guarantee ?? 0) > 0) { dailyRows.push([d.date, "mover_min_guarantee", round2(Number(d.mover_min_guarantee)), d.note ?? ""]); tOther += Number(d.mover_min_guarantee); }
      if (Number(d.hub ?? 0) > 0) { dailyRows.push([d.date, "hub_extra", round2(Number(d.hub)), d.note ?? ""]); tOther += Number(d.hub); }
    }
  }

  // ---- opex.csv (company operating expenses) ----
  const opexHeader = ["accrual_date", "category", "amount", "paid_date", "double_counted", "note"];
  const opexRows: unknown[][] = [opexHeader];
  let tAds = 0;
  const bizPath = join(ROOT, "COGS", "business_expenses.json");
  if (existsSync(bizPath)) {
    const biz = JSON.parse(readFileSync(bizPath, "utf-8"));
    for (const ad of biz.marketing?.newspaper_ads ?? []) { opexRows.push([ad.ad_date, "newspaper_ad", ad.amount, ad.paid_date ?? "", "no", "Gurgaon newspaper advertisement"]); tAds += Number(ad.amount); }
    for (const pay of biz.packer_wage?.payments ?? []) opexRows.push([pay.paid_date, "packer_wage_payment", pay.amount, pay.paid_date ?? "", "YES - already in per-line labour_cost; cash-flow reference only, do NOT add to P&L", `${pay.covers ?? ""} ${pay.note ?? ""}`.trim()]);
  }

  // ---- write files ----
  writeFileSync(join(OUT_DIR, "order_lines.csv"), csv(lineRows));
  writeFileSync(join(OUT_DIR, "orders.csv"), csv(orderRows));
  writeFileSync(join(OUT_DIR, "daily_other_costs.csv"), csv(dailyRows));
  writeFileSync(join(OUT_DIR, "opex.csv"), csv(opexRows));

  const grossMargin = round2(tRev - (tCogs + tPkg + tDel + tLab));
  const netAfterOther = round2(grossMargin - tOther - tAds);
  const dates = keptOrders.map((o) => o.delivery_date).sort();
  const readme = `# Good Fruit Club — P&L data export

Generated ${istDate(new Date().toISOString())} (IST). Upload these CSVs into a Claude chat and ask it to analyse.

## Files
- **orders.csv** — one row per order. **Authoritative revenue** (\`bill_total_revenue\` from the finalized bill) plus per-order summed COGS / packaging / delivery / labour, gross margin and margin %. Use this for the true P&L.
- **order_lines.csv** — one row per order line, for **product-level cost & margin** analysis. \`line_revenue = actual_qty x rate\`; this is exact for normal lines but approximate for gift boxes (see \`is_gift_box\`) — trust orders.csv for revenue totals.
- **daily_other_costs.csv** — day-level costs NOT attributed to any order (COD remittance incl. GST; off-day Mover min-guarantees). Add these to the P&L at day level.
- **opex.csv** — company operating expenses (newspaper ads = real OpEx; packer_wage_payment rows are **cash-flow reference only — already counted in per-line labour_cost**, flagged \`double_counted=YES\`, do NOT add again).

## How the P&L composes
Net = Σ revenue − Σ(COGS + packaging + delivery + labour)  [orders.csv]  − Σ daily_other_costs  − Σ newspaper_ad OpEx

## Coverage & caveats
- Order dates: ${dates[0] ?? "n/a"} → ${dates[dates.length - 1] ?? "n/a"}. Costs are complete Aug 4 2026 onward; ≤ Aug 3 carries COGS/packaging/delivery from the historical sheet; labour starts 3 Jul 2026 (packer start).
- Internal customers (${[...internal].join(", ") || "none"}) and cancelled orders are excluded.
- Sep labour is provisional (base only; Sunday extras + actual Sep pay pending). Sep 27–28 delivery not yet in (awaiting updated Mover sheet).
- Delivery costs already include the West-Delhi→Gurgaon hub split + per-order Mover leg (incl. 18% GST). \`daily_other_costs\` min-guarantees may still need 18% GST added depending on how you treat them.

## Totals in this export (sanity check)
- Revenue: ₹${tRev.toLocaleString("en-IN")}
- COGS ₹${round2(tCogs).toLocaleString("en-IN")} | Packaging ₹${round2(tPkg).toLocaleString("en-IN")} | Delivery ₹${round2(tDel).toLocaleString("en-IN")} | Labour ₹${round2(tLab).toLocaleString("en-IN")}
- Gross margin (after the 4 per-order costs): ₹${grossMargin.toLocaleString("en-IN")}
- Day-level other costs: ₹${round2(tOther).toLocaleString("en-IN")} | Newspaper ads: ₹${round2(tAds).toLocaleString("en-IN")}
- Net after other + ads: ₹${netAfterOther.toLocaleString("en-IN")}
`;
  writeFileSync(join(OUT_DIR, "README.md"), readme);

  console.log(`Wrote to ${OUT_DIR}:`);
  console.log(`  orders.csv          ${keptOrders.length} orders`);
  console.log(`  order_lines.csv     ${lineRows.length - 1} lines`);
  console.log(`  daily_other_costs.csv ${dailyRows.length - 1} rows (₹${round2(tOther)})`);
  console.log(`  opex.csv            ${opexRows.length - 1} rows (ads ₹${round2(tAds)})`);
  console.log(`  README.md`);
  console.log(`\nRevenue ₹${tRev.toLocaleString("en-IN")} | COGS ₹${round2(tCogs)} | Pkg ₹${round2(tPkg)} | Delivery ₹${round2(tDel)} | Labour ₹${round2(tLab)}`);
  console.log(`Gross margin ₹${grossMargin.toLocaleString("en-IN")} | Net after other+ads ₹${netAfterOther.toLocaleString("en-IN")}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
