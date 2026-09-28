import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import ExcelJS from "exceljs";

const RAW = "COGS/delivery/_mover_sheet_raw.json";
const cell = (v: any): string => {
  if (v == null) return "";
  if (typeof v === "object") return String(v.result ?? v.text ?? "");
  return String(v).trim();
};
const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
const toDate = (name: string): string | null => {
  const m = name.toLowerCase().match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)/);
  const mon = m && MONTHS[m[2]?.slice(0, 3)];
  return m && mon ? `2026-${mon}-${m[1].padStart(2, "0")}` : null;
};
const SKIP = /subtotal|gst|total|balance|advance|adjust|pilot|w2|remittance|charges|date/i;

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(JSON.parse(readFileSync(RAW, "utf-8")).content, "base64") as unknown as ExcelJS.Buffer);

  // 1. Authoritative daily Charges (pre-GST, incl reverse-COD handover) from Payment Details.
  const charges = new Map<string, number>();
  const pd = wb.worksheets.find((w) => w.name.toLowerCase().includes("payment"))!;
  pd.eachRow((row) => {
    const v = (row.values as any[]).map(cell);
    for (let c = 1; c < v.length; c++) {
      const label = v[c];
      const next = Number(v[c + 1]);
      if (label && !SKIP.test(label) && toDate(label) && Number.isFinite(next) && next > 0) {
        charges.set(toDate(label)!, next);
      }
    }
  });

  // 2. Per-order Mover sum (pre-GST) per day from the matched mover files.
  const orderSum = new Map<string, number>();
  for (const f of readdirSync("COGS/delivery/mover")) {
    const d = f.replace(".json", "");
    const inclGst = JSON.parse(readFileSync("COGS/delivery/mover/" + f, "utf-8")).reduce((a: number, r: any) => a + r.cost, 0);
    orderSum.set(d, inclGst / 1.18);
  }

  // 3. COD remittance = daily Charges - per-order Mover sum (only for days that
  //    have a per-order breakdown; clamp tiny negative sheet-rounding to 0).
  const days: { date: string; charges: number; order_sum: number; cod_remittance: number }[] = [];
  const noBreakdown: { date: string; charges: number }[] = [];
  for (const [date, ch] of [...charges.entries()].sort()) {
    if (!orderSum.has(date)) { noBreakdown.push({ date, charges: ch }); continue; }
    const os = orderSum.get(date)!;
    const rem = Math.max(0, Math.round((ch - os) * 100) / 100);
    days.push({ date, charges: ch, order_sum: Math.round(os * 100) / 100, cod_remittance: rem });
  }
  const withRem = days.filter((d) => d.cod_remittance >= 1);
  const total = days.reduce((a, d) => a + d.cod_remittance, 0);

  writeFileSync("COGS/delivery/cod_remittance.json", JSON.stringify({
    _note: "Daily COD-remittance / reverse-COD-handover fee = Payment-Details daily Charges (pre-GST, incl reverse COD) minus the summed per-order Mover 'Total Delivery Cost'. A DAY-LEVEL cost for company P&L -- NOT allocated to orders. Add 18% GST for the amount actually paid.",
    total_cod_remittance_pre_gst: Math.round(total * 100) / 100,
    total_cod_remittance_incl_gst: Math.round(total * 1.18 * 100) / 100,
    days,
    days_without_per_order_breakdown: noBreakdown,
  }, null, 2) + "\n");

  console.log(`Days with COD remittance (>=1): ${withRem.length}/${days.length}`);
  withRem.forEach((d) => console.log(`  ${d.date}: remittance ${d.cod_remittance.toFixed(2)}  (charges ${d.charges}, orders ${d.order_sum.toFixed(2)})`));
  console.log(`\nTotal COD remittance pre-GST: ${total.toFixed(2)}  | incl 18% GST: ${(total * 1.18).toFixed(2)}`);
  if (noBreakdown.length) {
    console.log(`\nDays with a daily charge but NO per-order breakdown in the sheet (delivery cost NOT applied per order -- decide separately):`);
    noBreakdown.forEach((d) => console.log(`  ${d.date}: charges ${d.charges}`));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
