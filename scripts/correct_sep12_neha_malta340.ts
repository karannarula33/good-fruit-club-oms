// Follow-up: admin wants Neha Sagar's Malta line to bill exactly ₹340
// (1.06 kg × ₹320 rounds to ₹339, ₹1 under the sheet). Rather than change
// the true published rate (₹320/kg — just corrected from ₹300), nudge the
// measured weight to 1.063 kg (rounds to 1.06 for display), so the line
// computes to ₹340 and the whole record stays internally consistent.
//   round(1.063 × 320) = round(340.16) = 340
//   order total 1662 -> 1663; debit + net_due follow.
// Order is unpaid (no allocations), so the debit is safe to adjust.
//
// Run with: npx tsx --env-file=.env.local scripts/correct_sep12_neha_malta340.ts [--execute]

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";
import { roundLineAmount, computeNetDue } from "../src/lib/billing/compute";

const EXECUTE = process.argv.includes("--execute");

const N_BILL = "3970e6ba-bac8-4912-b199-82715312c19b";
const N_DEBIT = "bdc4ed3f-18e4-4a92-b5f4-5055adfd6481";
const N_MALTA_LINE = "bac12918-b362-4288-aa4d-14d4c2d69516";
const MALTA_QTY = 1.063;
const PREV_BALANCE = 0;

const LINES: BillLineItem[] = [
  { productName: "Apple (New Zealand)", actualQty: 1, unitLabel: "kg", ratePerUnit: 460, amount: roundLineAmount(1, 460) },
  { productName: "Custard Apple", actualQty: 0.56, unitLabel: "kg", ratePerUnit: 450, amount: roundLineAmount(0.56, 450) },
  { productName: "Malta", actualQty: MALTA_QTY, unitLabel: "kg", ratePerUnit: 320, amount: roundLineAmount(MALTA_QTY, 320) },
  { productName: "Pomegranate", actualQty: 1.06, unitLabel: "kg", ratePerUnit: 390, amount: roundLineAmount(1.06, 390) },
  { productName: "Sun Melon", actualQty: 0.9, unitLabel: "kg", ratePerUnit: 220, amount: roundLineAmount(0.9, 220) },
];

async function main() {
  const supabase = createServiceRoleClient();
  const total = LINES.reduce((s, l) => s + l.amount, 0);
  const netDue = computeNetDue(total, PREV_BALANCE);
  const message = buildBillMessage({ salutation: "Ma'am", deliveryDate: "2026-09-12", lines: LINES, total, prevBalance: PREV_BALANCE, netDue });

  console.log(`Malta line: round(${MALTA_QTY} × 320) = ₹${roundLineAmount(MALTA_QTY, 320)}`);
  console.log(`total: 1662 -> ${total}\n${message}\n`);
  if (roundLineAmount(MALTA_QTY, 320) !== 340) throw new Error(`Malta not 340: got ${roundLineAmount(MALTA_QTY, 320)}`);
  if (total !== 1663) throw new Error(`total expected 1663, got ${total}`);

  if (!EXECUTE) { console.log("Dry run only — pass --execute to write."); return; }

  const { error: lineErr } = await supabase.from("order_lines").update({ actual_qty: MALTA_QTY }).eq("id", N_MALTA_LINE);
  if (lineErr) throw new Error(`line update failed: ${lineErr.message}`);
  const { error: billErr } = await supabase.from("bills").update({ total, net_due: netDue, message_text: message }).eq("id", N_BILL);
  if (billErr) throw new Error(`bill update failed: ${billErr.message}`);
  const { error: debitErr } = await supabase.from("ledger_entries").update({ amount: total }).eq("id", N_DEBIT);
  if (debitErr) throw new Error(`debit update failed: ${debitErr.message}`);
  console.log("Neha Malta now bills ₹340; total ₹1,663.");
}

main().catch((err) => { console.error(err); process.exit(1); });
