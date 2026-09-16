// Corrects two live-app Aug 29, 2026 orders per admin-supplied item
// breakdown:
//   - Vipin Suri: bill was missing an Afghan Cherry line (1 box, ₹800).
//     total 3223 -> 4023.
//   - Punam Kumar: Malta line was priced at ₹280/kg, should reconcile to
//     ₹700 for 2.65kg (~₹264.15/kg, backed out so qty*rate matches the
//     admin-stated line amount exactly). total 2177 -> 2135.
// Both orders have exactly one plain (unpaid, no matching credit) ledger
// debit tied to them via order_id — safe to adjust in place since nothing
// has been collected against the old (wrong) amount yet.
//
// Run with: npx tsx --env-file=.env.local scripts/correct_aug29_vipin_punam.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";

const EXECUTE = process.argv.includes("--execute");

const VIPIN_ORDER_ID = "97d4bdd5-ef4e-439b-96f4-04228e9ca9f6";
const VIPIN_BILL_ID = "63f7370c-15f0-4fdd-94ba-164252c8b5db";
const VIPIN_DEBIT_ID = "b826718d-8e40-4311-bf12-8a61ff1e3e7d";
const VIPIN_PREV_BALANCE = 1160;
const AFGHAN_CHERRY_ID = "c23881fb-e557-44fe-a514-f715a1c7a3d5";

const PUNAM_ORDER_ID = "937a81e3-0e8d-49b1-b280-a34040c64c88";
const PUNAM_BILL_ID = "c1975c8b-ee67-42f7-96b6-db35181777f4";
const PUNAM_DEBIT_ID = "d0cd41f0-72a3-4dd4-936a-d4adf8c88053";
const PUNAM_MALTA_LINE_ID = "f4995b87-6a75-4a15-aa65-17192f16fc0b";
const PUNAM_MALTA_QTY = 2.65;
const PUNAM_MALTA_AMOUNT = 700;
const PUNAM_MALTA_RATE = Math.round((PUNAM_MALTA_AMOUNT / PUNAM_MALTA_QTY) * 100) / 100;
const PUNAM_PREV_BALANCE = 0;

async function main() {
  const supabase = createServiceRoleClient();

  // ---- Vipin Suri ----
  const vipinLines: BillLineItem[] = [
    { productName: "Donut Peaches – 1 box", actualQty: 1, unitLabel: "Box", ratePerUnit: 550, amount: 550 },
    { productName: "Avocado", actualQty: 2, unitLabel: "Piece", ratePerUnit: 170, amount: 340 },
    { productName: "Pusa Mango – 1 kg", actualQty: 1, unitLabel: "kg", ratePerUnit: 650, amount: 650 },
    { productName: "Apple (New Zealand)", actualQty: 2, unitLabel: "kg", ratePerUnit: 460, amount: 920 },
    { productName: "Papaya", actualQty: 2.3, unitLabel: "kg", ratePerUnit: 150, amount: 345 },
    { productName: "Pomegranate", actualQty: 1.1, unitLabel: "kg", ratePerUnit: 380, amount: 418 },
    { productName: "Afghan Cherry", actualQty: 1, unitLabel: "Box", ratePerUnit: 800, amount: 800 },
  ];
  const vipinTotal = vipinLines.reduce((s, l) => s + l.amount, 0);
  const vipinNetDue = VIPIN_PREV_BALANCE + vipinTotal;
  const vipinMessage = buildBillMessage({
    salutation: "Sir",
    deliveryDate: "2026-08-29",
    lines: vipinLines,
    total: vipinTotal,
    prevBalance: VIPIN_PREV_BALANCE,
    netDue: vipinNetDue,
  });

  console.log("=== Vipin Suri ===");
  console.log(`  add line: Afghan Cherry 1 box @ ₹800`);
  console.log(`  bill.total: 3223 -> ${vipinTotal}`);
  console.log(`  bill.net_due: 4383 -> ${vipinNetDue}`);
  console.log(`  ledger debit ${VIPIN_DEBIT_ID}: 3223 -> ${vipinTotal}`);
  console.log(`\n--- message_text ---\n${vipinMessage}\n---------------------\n`);

  // ---- Punam Kumar ----
  const punamLines: BillLineItem[] = [
    { productName: "Afghan Cherry", actualQty: 1, unitLabel: "Box", ratePerUnit: 800, amount: 800 },
    { productName: "Pomegranate", actualQty: 0.75, unitLabel: "kg", ratePerUnit: 380, amount: 285 },
    { productName: "Malta", actualQty: PUNAM_MALTA_QTY, unitLabel: "kg", ratePerUnit: PUNAM_MALTA_RATE, amount: PUNAM_MALTA_AMOUNT },
    { productName: "Pears", actualQty: 1, unitLabel: "kg", ratePerUnit: 350, amount: 350 },
  ];
  const punamTotal = punamLines.reduce((s, l) => s + l.amount, 0);
  const punamNetDue = PUNAM_PREV_BALANCE + punamTotal;
  const punamMessage = buildBillMessage({
    salutation: "Ma'am",
    deliveryDate: "2026-08-29",
    lines: punamLines,
    total: punamTotal,
    prevBalance: PUNAM_PREV_BALANCE,
    netDue: punamNetDue,
  });

  console.log("=== Punam Kumar ===");
  console.log(`  Malta line rate: 280 -> ${PUNAM_MALTA_RATE} (2.65kg, amount 742 -> ${PUNAM_MALTA_AMOUNT})`);
  console.log(`  bill.total: 2177 -> ${punamTotal}`);
  console.log(`  bill.net_due: 2177 -> ${punamNetDue}`);
  console.log(`  ledger debit ${PUNAM_DEBIT_ID}: 2177 -> ${punamTotal}`);
  console.log(`\n--- message_text ---\n${punamMessage}\n---------------------\n`);

  if (!EXECUTE) {
    console.log("Dry run only — pass --execute to write.");
    return;
  }

  // Vipin Suri writes
  const { error: vipinLineError } = await supabase.from("order_lines").insert({
    order_id: VIPIN_ORDER_ID,
    product_id: AFGHAN_CHERRY_ID,
    ordered_qty: 1,
    ordered_unit: "box",
    locked_price_per_unit: 800,
    actual_qty: 1,
    line_status: "packed",
    is_substitution: false,
    parse_confidence: "clean",
    parse_note: null,
  });
  if (vipinLineError) throw new Error(`vipin line insert failed: ${vipinLineError.message}`);

  const { error: vipinBillError } = await supabase
    .from("bills")
    .update({ total: vipinTotal, net_due: vipinNetDue, message_text: vipinMessage })
    .eq("id", VIPIN_BILL_ID);
  if (vipinBillError) throw new Error(`vipin bill update failed: ${vipinBillError.message}`);

  const { error: vipinDebitError } = await supabase
    .from("ledger_entries")
    .update({ amount: vipinTotal })
    .eq("id", VIPIN_DEBIT_ID);
  if (vipinDebitError) throw new Error(`vipin debit update failed: ${vipinDebitError.message}`);

  const { error: vipinNoteError } = await supabase
    .from("orders")
    .update({ notes: "Corrected 2026-09-14: added missing Afghan Cherry line (1 box, ₹800) per admin-supplied item breakdown." })
    .eq("id", VIPIN_ORDER_ID);
  if (vipinNoteError) throw new Error(`vipin order note update failed: ${vipinNoteError.message}`);

  console.log("Vipin Suri corrected.");

  // Punam Kumar writes
  const { error: punamLineError } = await supabase
    .from("order_lines")
    .update({ locked_price_per_unit: PUNAM_MALTA_RATE })
    .eq("id", PUNAM_MALTA_LINE_ID);
  if (punamLineError) throw new Error(`punam line update failed: ${punamLineError.message}`);

  const { error: punamBillError } = await supabase
    .from("bills")
    .update({ total: punamTotal, net_due: punamNetDue, message_text: punamMessage })
    .eq("id", PUNAM_BILL_ID);
  if (punamBillError) throw new Error(`punam bill update failed: ${punamBillError.message}`);

  const { error: punamDebitError } = await supabase
    .from("ledger_entries")
    .update({ amount: punamTotal })
    .eq("id", PUNAM_DEBIT_ID);
  if (punamDebitError) throw new Error(`punam debit update failed: ${punamDebitError.message}`);

  const { error: punamNoteError } = await supabase
    .from("orders")
    .update({ notes: "Corrected 2026-09-14: Malta rate corrected from ₹280/kg to ₹264.15/kg per admin-supplied item breakdown." })
    .eq("id", PUNAM_ORDER_ID);
  if (punamNoteError) throw new Error(`punam order note update failed: ${punamNoteError.message}`);

  console.log("Punam Kumar corrected.");
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
