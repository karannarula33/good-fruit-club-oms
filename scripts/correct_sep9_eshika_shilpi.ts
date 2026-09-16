// Corrects two live-app Sep 9, 2026 orders per admin-supplied item
// breakdown. Both orders have exactly one plain (unpaid, no matching
// credit) ledger debit tied to them via order_id — safe to adjust.
//
//   - Eshika Kanodia: Mandarin Orange qty corrected 1.03 -> 1.0kg
//     (amount 433 -> 420); everything else already matched.
//     total 3294 -> 3281.
//   - Shilpi Kapoor: Muscat Grapes line corrected from
//     "0.49 Box @ ₹900 = ₹441" to "0.5 kg @ ₹960 = ₹480" — billed by
//     weight this time (same ambiguity as Piyush Soni's order earlier).
//     total 1456 -> 1495.
//
// Run with: npx tsx --env-file=.env.local scripts/correct_sep9_eshika_shilpi.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";

const EXECUTE = process.argv.includes("--execute");

const ESHIKA_ORDER_ID = "ff0d52a2-cbe4-4695-b2a8-eb777b021628";
const ESHIKA_BILL_ID = "498dd1eb-e45d-4d6d-b1a7-9513f6e1476a";
const ESHIKA_DEBIT_ID = "395350eb-612a-48a9-8bc9-b4c2b044501e";
const ESHIKA_MANDARIN_LINE_ID = "6c64c4cd-fc09-4ceb-b14d-dc33a314e628";

const SHILPI_ORDER_ID = "7b73916b-b795-455e-9fa0-cb8c637d7683";
const SHILPI_BILL_ID = "32f0ad08-3911-4e8e-9295-589f78757f24";
const SHILPI_DEBIT_ID = "9c6e05fd-39d0-4600-88a8-b6d092c95b45";
const SHILPI_MUSCAT_LINE_ID = "033571f8-4329-47ef-a974-3fe196bd2c3e";

async function main() {
  const supabase = createServiceRoleClient();

  // ---- Eshika Kanodia ----
  const eshikaLines: BillLineItem[] = [
    { productName: "Pears", actualQty: 1.07, unitLabel: "kg", ratePerUnit: 350, amount: 375 },
    { productName: "Pomegranate", actualQty: 1.22, unitLabel: "kg", ratePerUnit: 390, amount: 476 },
    { productName: "Mandarin Orange", actualQty: 1.0, unitLabel: "kg", ratePerUnit: 420, amount: 420 },
    { productName: "Jumbo Blueberry", actualQty: 2, unitLabel: "Box", ratePerUnit: 330, amount: 660 },
    { productName: "Apple (New Zealand)", actualQty: 1, unitLabel: "kg", ratePerUnit: 460, amount: 460 },
    { productName: "Avocado", actualQty: 2, unitLabel: "Piece", ratePerUnit: 170, amount: 340 },
    { productName: "Green Kiwi", actualQty: 1, unitLabel: "Box", ratePerUnit: 430, amount: 430 },
    { productName: "Banana", actualQty: 1, unitLabel: "dozen", ratePerUnit: 120, amount: 120 },
  ];
  const eshikaTotal = eshikaLines.reduce((s, l) => s + l.amount, 0);
  const eshikaMessage = buildBillMessage({
    salutation: "Ma'am",
    deliveryDate: "2026-09-09",
    lines: eshikaLines,
    total: eshikaTotal,
    prevBalance: 0,
    netDue: eshikaTotal,
  });
  console.log("=== Eshika Kanodia ===");
  console.log(`  Mandarin Orange: 1.03kg/₹433 -> 1.0kg/₹420`);
  console.log(`  total: 3294 -> ${eshikaTotal}`);
  console.log(`\n${eshikaMessage}\n`);

  // ---- Shilpi Kapoor ----
  const shilpiLines: BillLineItem[] = [
    { productName: "Muscat Grapes", actualQty: 0.5, unitLabel: "kg", ratePerUnit: 960, amount: 480 },
    { productName: "Jumbo Blueberry", actualQty: 1, unitLabel: "Box", ratePerUnit: 330, amount: 330 },
    { productName: "Orange Passion Fruit (Sweet Granadilla)", actualQty: 0.5, unitLabel: "kg", ratePerUnit: 1000, amount: 500 },
    { productName: "Papaya", actualQty: 1.23, unitLabel: "kg", ratePerUnit: 150, amount: 185 },
  ];
  const shilpiTotal = shilpiLines.reduce((s, l) => s + l.amount, 0);
  const shilpiMessage = buildBillMessage({
    salutation: "Ma'am",
    deliveryDate: "2026-09-09",
    lines: shilpiLines,
    total: shilpiTotal,
    prevBalance: 0,
    netDue: shilpiTotal,
  });
  console.log("=== Shilpi Kapoor ===");
  console.log(`  Muscat Grapes: 0.49 Box/₹441 -> 0.5 kg/₹480`);
  console.log(`  total: 1456 -> ${shilpiTotal}`);
  console.log(`\n${shilpiMessage}\n`);

  if (!EXECUTE) {
    console.log("Dry run only — pass --execute to write.");
    return;
  }

  // Eshika Kanodia writes
  const { error: eshikaLineErr } = await supabase
    .from("order_lines")
    .update({ actual_qty: 1.0 })
    .eq("id", ESHIKA_MANDARIN_LINE_ID);
  if (eshikaLineErr) throw new Error(`eshika line update failed: ${eshikaLineErr.message}`);

  const { error: eshikaBillErr } = await supabase
    .from("bills")
    .update({ total: eshikaTotal, net_due: eshikaTotal, message_text: eshikaMessage })
    .eq("id", ESHIKA_BILL_ID);
  if (eshikaBillErr) throw new Error(`eshika bill update failed: ${eshikaBillErr.message}`);

  const { error: eshikaDebitErr } = await supabase
    .from("ledger_entries")
    .update({ amount: eshikaTotal })
    .eq("id", ESHIKA_DEBIT_ID);
  if (eshikaDebitErr) throw new Error(`eshika debit update failed: ${eshikaDebitErr.message}`);

  console.log("Eshika Kanodia corrected.");

  // Shilpi Kapoor writes
  const { error: shilpiLineErr } = await supabase
    .from("order_lines")
    .update({ ordered_unit: "kg", actual_qty: 0.5, locked_price_per_unit: 960 })
    .eq("id", SHILPI_MUSCAT_LINE_ID);
  if (shilpiLineErr) throw new Error(`shilpi line update failed: ${shilpiLineErr.message}`);

  const { error: shilpiBillErr } = await supabase
    .from("bills")
    .update({ total: shilpiTotal, net_due: shilpiTotal, message_text: shilpiMessage })
    .eq("id", SHILPI_BILL_ID);
  if (shilpiBillErr) throw new Error(`shilpi bill update failed: ${shilpiBillErr.message}`);

  const { error: shilpiDebitErr } = await supabase
    .from("ledger_entries")
    .update({ amount: shilpiTotal })
    .eq("id", SHILPI_DEBIT_ID);
  if (shilpiDebitErr) throw new Error(`shilpi debit update failed: ${shilpiDebitErr.message}`);

  console.log("Shilpi Kapoor corrected.");
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
