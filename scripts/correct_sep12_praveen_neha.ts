// Two Sep 12, 2026 corrections (admin-supplied, sheet-authoritative).
//
// 1) Praveen Agarwal — his Sep 12 order was entered as TWO separate orders
//    (CLAUDE.md §3.9 says same-customer same-day pastes should merge). Club
//    them into one:
//      A (survives) 3e4df0ec: Mangosteen 1 kg @ ₹1050 = ₹1050
//      B (folded in) 9ff818ab: Golden Kiwi 2 Box @ ₹480 = ₹960,
//                              Pomegranate 1.15 kg @ ₹390 = ₹448
//    B's 2 lines + its big_box package move onto A; A's bill/debit grow to
//    the combined ₹2458 (prev_balance 16826.2 → net_due 19284.2, exactly
//    B's old final net_due, so the running balance is unchanged); B's bill,
//    debit, and order row are deleted. Both orders are unpaid (no payment
//    allocations), so adjusting the debits is safe. Per-line price/qty
//    override rows key off order_line_id, so they travel with the lines.
//
// 2) Neha Sagar (order 69536b9b, unpaid) — Malta line was priced ₹300; the
//    correct rate is ₹320. Only that line changes. NOTE: 1.06 × 320 = 339.2
//    → the app rounds to ₹339 (not the ₹340 in the admin breakdown — a ₹1
//    rounding artifact on the fractional weight, flagged, left honest).
//    Total 1641 → 1662.
//
// Run with: npx tsx --env-file=.env.local scripts/correct_sep12_praveen_neha.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";
import { roundLineAmount, computeNetDue } from "../src/lib/billing/compute";

const EXECUTE = process.argv.includes("--execute");

// --- Praveen Agarwal ---
const P_ORDER_A = "3e4df0ec-3f7b-44b0-bcae-27d62f08d1db"; // survives
const P_ORDER_B = "9ff818ab-647c-4271-a679-c88c9667a8b8"; // folded in + deleted
const P_BILL_A = "6a3090a2-ad8b-4d97-a52c-a9ffe9f68d9d";
const P_BILL_B = "1a733ff6-0971-4348-be92-0647ae889c22";
const P_DEBIT_A = "e4b38b85-0914-4f12-9d0b-db5d1713c9e5";
const P_DEBIT_B = "edf9fadf-f217-46b0-a949-d5d4777cebdc";
const P_PREV_BALANCE = 16826.2;
const P_DELIVERY = "2026-09-12";
const P_LINES: BillLineItem[] = [
  { productName: "Mangosteen", actualQty: 1, unitLabel: "kg", ratePerUnit: 1050, amount: roundLineAmount(1, 1050) },
  { productName: "Golden Kiwi", actualQty: 2, unitLabel: "Box", ratePerUnit: 480, amount: roundLineAmount(2, 480) },
  { productName: "Pomegranate", actualQty: 1.15, unitLabel: "kg", ratePerUnit: 390, amount: roundLineAmount(1.15, 390) },
];

// --- Neha Sagar ---
const N_ORDER = "69536b9b-4153-46cd-a476-987339e83e64";
const N_BILL = "3970e6ba-bac8-4912-b199-82715312c19b";
const N_DEBIT = "bdc4ed3f-18e4-4a92-b5f4-5055adfd6481";
const N_MALTA_LINE = "bac12918-b362-4288-aa4d-14d4c2d69516";
const N_PREV_BALANCE = 0;
const N_DELIVERY = "2026-09-12";
const N_LINES: BillLineItem[] = [
  { productName: "Apple (New Zealand)", actualQty: 1, unitLabel: "kg", ratePerUnit: 460, amount: roundLineAmount(1, 460) },
  { productName: "Custard Apple", actualQty: 0.56, unitLabel: "kg", ratePerUnit: 450, amount: roundLineAmount(0.56, 450) },
  { productName: "Malta", actualQty: 1.06, unitLabel: "kg", ratePerUnit: 320, amount: roundLineAmount(1.06, 320) },
  { productName: "Pomegranate", actualQty: 1.06, unitLabel: "kg", ratePerUnit: 390, amount: roundLineAmount(1.06, 390) },
  { productName: "Sun Melon", actualQty: 0.9, unitLabel: "kg", ratePerUnit: 220, amount: roundLineAmount(0.9, 220) },
];

async function main() {
  const supabase = createServiceRoleClient();

  const pTotal = P_LINES.reduce((s, l) => s + l.amount, 0);
  const pNetDue = computeNetDue(pTotal, P_PREV_BALANCE);
  const pMessage = buildBillMessage({ salutation: "Sir", deliveryDate: P_DELIVERY, lines: P_LINES, total: pTotal, prevBalance: P_PREV_BALANCE, netDue: pNetDue });

  const nTotal = N_LINES.reduce((s, l) => s + l.amount, 0);
  const nNetDue = computeNetDue(nTotal, N_PREV_BALANCE);
  const nMessage = buildBillMessage({ salutation: "Ma'am", deliveryDate: N_DELIVERY, lines: N_LINES, total: nTotal, prevBalance: N_PREV_BALANCE, netDue: nNetDue });

  console.log("=== Praveen Agarwal — club 2 orders into 1 ===");
  console.log(`  combined total: 1050 + 1408 -> ${pTotal}; net_due -> ${pNetDue}`);
  console.log(`  delete order B ${P_ORDER_B} (bill + debit)`);
  console.log(`\n${pMessage}\n`);
  console.log("=== Neha Sagar — Malta ₹300 -> ₹320 ===");
  console.log(`  total: 1641 -> ${nTotal} (Malta line = ₹${roundLineAmount(1.06, 320)}; admin wrote ₹340 -> ₹1 rounding)`);
  console.log(`\n${nMessage}\n`);

  if (pTotal !== 2458) throw new Error(`Praveen total expected 2458, got ${pTotal}`);
  if (nTotal !== 1662) throw new Error(`Neha total expected 1662, got ${nTotal}`);

  if (!EXECUTE) {
    console.log("Dry run only — pass --execute to write.");
    return;
  }

  // ---- Praveen: club B into A ----
  // 1. Move B's lines and package onto A.
  const { error: mvLines } = await supabase.from("order_lines").update({ order_id: P_ORDER_A }).eq("order_id", P_ORDER_B);
  if (mvLines) throw new Error(`move lines failed: ${mvLines.message}`);
  const { error: mvPkg } = await supabase.from("order_packages").update({ order_id: P_ORDER_A }).eq("order_id", P_ORDER_B);
  if (mvPkg) throw new Error(`move package failed: ${mvPkg.message}`);

  // 2. Grow A's bill + debit to the combined figure.
  const { error: pBillErr } = await supabase.from("bills").update({ total: pTotal, net_due: pNetDue, message_text: pMessage }).eq("id", P_BILL_A);
  if (pBillErr) throw new Error(`A bill update failed: ${pBillErr.message}`);
  const { error: pDebitErr } = await supabase.from("ledger_entries").update({ amount: pTotal }).eq("id", P_DEBIT_A);
  if (pDebitErr) throw new Error(`A debit update failed: ${pDebitErr.message}`);

  // 3. Delete B's bill, debit, then the order row (now empty of lines/packages).
  const { error: delBill } = await supabase.from("bills").delete().eq("id", P_BILL_B);
  if (delBill) throw new Error(`delete B bill failed: ${delBill.message}`);
  const { error: delDebit } = await supabase.from("ledger_entries").delete().eq("id", P_DEBIT_B);
  if (delDebit) throw new Error(`delete B debit failed: ${delDebit.message}`);
  const { error: delOrder } = await supabase.from("orders").delete().eq("id", P_ORDER_B);
  if (delOrder) throw new Error(`delete B order failed: ${delOrder.message}`);
  console.log("Praveen Agarwal orders clubbed.");

  // ---- Neha: Malta price ----
  const { error: nLineErr } = await supabase.from("order_lines").update({ locked_price_per_unit: 320 }).eq("id", N_MALTA_LINE);
  if (nLineErr) throw new Error(`Neha Malta line update failed: ${nLineErr.message}`);
  const { error: nBillErr } = await supabase.from("bills").update({ total: nTotal, net_due: nNetDue, message_text: nMessage }).eq("id", N_BILL);
  if (nBillErr) throw new Error(`Neha bill update failed: ${nBillErr.message}`);
  const { error: nDebitErr } = await supabase.from("ledger_entries").update({ amount: nTotal }).eq("id", N_DEBIT);
  if (nDebitErr) throw new Error(`Neha debit update failed: ${nDebitErr.message}`);
  console.log("Neha Sagar corrected.");

  console.log("\nDone.");
}

main().catch((err) => { console.error(err); process.exit(1); });
