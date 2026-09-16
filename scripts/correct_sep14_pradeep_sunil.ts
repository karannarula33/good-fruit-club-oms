// Corrects two live-app Sep 14, 2026 orders per admin-supplied breakdown.
// Both orders are unpaid (no payment allocations), so bill total + ledger
// debit are safe to adjust together.
//
//   Pradeep Gupta (order 23d58559): total 1214 -> 1230
//     - Muscat Grapes 0.5 box @ ₹900 = ₹450  ->  1 box @ ₹480 = ₹480
//     - Custard Apple 1.03 kg @ ₹450 = ₹464   ->  1 kg @ ₹450 = ₹450
//     - Elaichi Banana 1 kg @ ₹300 = ₹300     (unchanged)
//
//   Sunil Malhotra (order 2124a278): total 2425 -> 2550
//     - Mandarin Orange 1.852 kg @ ₹420 = ₹778 -> 2.15 kg @ ₹420 = ₹903
//     - other 5 lines already matched
//
// Run with: npx tsx --env-file=.env.local scripts/correct_sep14_pradeep_sunil.ts [--execute]

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";
import { roundLineAmount, computeNetDue } from "../src/lib/billing/compute";

const EXECUTE = process.argv.includes("--execute");
const DELIVERY = "2026-09-14";

// --- Pradeep Gupta ---
const P_BILL = "24f7c613-7a91-4862-8253-5ea63423d0c8";
const P_DEBIT = "56c48bc2-9181-487b-9f78-4770b6c28f6d";
const P_PREV = 4342.8;
const P_MUSCAT_LINE = "bd698085-5618-4be5-a5b0-c252003e82b4";
const P_CUSTARD_LINE = "76031cd0-5cb4-4744-a6d8-0a8a08bb926c";
const P_LINES: BillLineItem[] = [
  { productName: "Yellaki (Elaichi) Banana", actualQty: 1, unitLabel: "kg", ratePerUnit: 300, amount: roundLineAmount(1, 300) },
  { productName: "Muscat Grapes", actualQty: 1, unitLabel: "box", ratePerUnit: 480, amount: roundLineAmount(1, 480) },
  { productName: "Custard Apple", actualQty: 1, unitLabel: "kg", ratePerUnit: 450, amount: roundLineAmount(1, 450) },
];

// --- Sunil Malhotra ---
const S_BILL = "99d6957c-4323-4b4c-9119-390203289dcd";
const S_DEBIT = "aed84c2a-ed03-453d-a12d-3fd998ca7dd2";
const S_PREV = 13025;
const S_MANDARIN_LINE = "84843d4d-00d2-497b-bb32-979e8faae842";
const S_LINES: BillLineItem[] = [
  { productName: "Mandarin Orange", actualQty: 2.15, unitLabel: "kg", ratePerUnit: 420, amount: roundLineAmount(2.15, 420) },
  { productName: "Dragon Fruit", actualQty: 2, unitLabel: "Piece", ratePerUnit: 130, amount: roundLineAmount(2, 130) },
  { productName: "Sun Melon", actualQty: 2.23, unitLabel: "kg", ratePerUnit: 220, amount: roundLineAmount(2.23, 220) },
  { productName: "Papaya", actualQty: 1.7, unitLabel: "kg", ratePerUnit: 150, amount: roundLineAmount(1.7, 150) },
  { productName: "Jumbo Blueberry", actualQty: 1, unitLabel: "Box", ratePerUnit: 340, amount: roundLineAmount(1, 340) },
  { productName: "Pomegranate", actualQty: 0.772, unitLabel: "kg", ratePerUnit: 390, amount: roundLineAmount(0.772, 390) },
];

async function main() {
  const supabase = createServiceRoleClient();

  const pTotal = P_LINES.reduce((s, l) => s + l.amount, 0);
  const pNet = computeNetDue(pTotal, P_PREV);
  const pMsg = buildBillMessage({ salutation: "Sir", deliveryDate: DELIVERY, lines: P_LINES, total: pTotal, prevBalance: P_PREV, netDue: pNet });

  const sTotal = S_LINES.reduce((s, l) => s + l.amount, 0);
  const sNet = computeNetDue(sTotal, S_PREV);
  const sMsg = buildBillMessage({ salutation: "Sir", deliveryDate: DELIVERY, lines: S_LINES, total: sTotal, prevBalance: S_PREV, netDue: sNet });

  console.log(`=== Pradeep Gupta === total 1214 -> ${pTotal}, net_due -> ${pNet}\n${pMsg}\n`);
  console.log(`=== Sunil Malhotra === total 2425 -> ${sTotal}, net_due -> ${sNet}\n${sMsg}\n`);
  if (pTotal !== 1230) throw new Error(`Pradeep total expected 1230, got ${pTotal}`);
  if (sTotal !== 2550) throw new Error(`Sunil total expected 2550, got ${sTotal}`);

  if (!EXECUTE) { console.log("Dry run only — pass --execute to write."); return; }

  // Pradeep line updates
  let e = (await supabase.from("order_lines").update({ actual_qty: 1, locked_price_per_unit: 480 }).eq("id", P_MUSCAT_LINE)).error;
  if (e) throw new Error(`Pradeep Muscat update: ${e.message}`);
  e = (await supabase.from("order_lines").update({ actual_qty: 1 }).eq("id", P_CUSTARD_LINE)).error;
  if (e) throw new Error(`Pradeep Custard update: ${e.message}`);
  e = (await supabase.from("bills").update({ total: pTotal, net_due: pNet, message_text: pMsg }).eq("id", P_BILL)).error;
  if (e) throw new Error(`Pradeep bill update: ${e.message}`);
  e = (await supabase.from("ledger_entries").update({ amount: pTotal }).eq("id", P_DEBIT)).error;
  if (e) throw new Error(`Pradeep debit update: ${e.message}`);
  console.log("Pradeep Gupta corrected.");

  // Sunil line update
  e = (await supabase.from("order_lines").update({ actual_qty: 2.15 }).eq("id", S_MANDARIN_LINE)).error;
  if (e) throw new Error(`Sunil Mandarin update: ${e.message}`);
  e = (await supabase.from("bills").update({ total: sTotal, net_due: sNet, message_text: sMsg }).eq("id", S_BILL)).error;
  if (e) throw new Error(`Sunil bill update: ${e.message}`);
  e = (await supabase.from("ledger_entries").update({ amount: sTotal }).eq("id", S_DEBIT)).error;
  if (e) throw new Error(`Sunil debit update: ${e.message}`);
  console.log("Sunil Malhotra corrected.");

  console.log("\nDone.");
}

main().catch((err) => { console.error(err); process.exit(1); });
