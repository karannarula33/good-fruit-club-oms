// Corrects three live-app Sep 1, 2026 orders per admin-supplied item
// breakdown. All three orders have exactly one plain (unpaid, no matching
// credit) ledger debit tied to them via order_id — safe to adjust in
// place since nothing has been collected against the old (wrong) amount.
//
//   - Archana Kakkar: Mini Guava/Mandarin Orange/Red Globe Grapes qty+rate
//     corrections. Black Amber Plums and Donut Peaches already correct.
//     total 1646 -> 1607.
//   - Simran Kumar: the Blueberry line was priced/producted as "Normal
//     Blueberry @ ₹230" but should be "Jumbo Blueberry @ ₹330" (a
//     distinct real catalog product). total 230 -> 330.
//   - Rita Parkash: Red Globe Grapes rate correction, 540 -> 580/kg.
//     total 313 -> 337.
//
// Run with: npx tsx --env-file=.env.local scripts/correct_sep1_archana_simran_rita.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";

const EXECUTE = process.argv.includes("--execute");
const JUMBO_BLUEBERRY_ID = "583d87b2-586c-4d58-b622-b70c7a29527b";

async function main() {
  const supabase = createServiceRoleClient();

  // ---- Archana Kakkar ----
  const archanaLines: BillLineItem[] = [
    { productName: "Black Amber Plums", actualQty: 1.028, unitLabel: "kg", ratePerUnit: 350, amount: 360 },
    { productName: "Mini Guava", actualQty: 1.0, unitLabel: "kg", ratePerUnit: 260, amount: 260 },
    { productName: "Mandarin Orange", actualQty: 1.03, unitLabel: "kg", ratePerUnit: 359.22, amount: 370 },
    { productName: "Donut Peaches – 1 box", actualQty: 0.5, unitLabel: "Box", ratePerUnit: 550, amount: 275 },
    { productName: "Red Globe Grapes", actualQty: 0.6, unitLabel: "kg", ratePerUnit: 570, amount: 342 },
  ];
  const archanaTotal = Math.round(archanaLines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const archanaMessage = buildBillMessage({
    salutation: "Ma'am",
    deliveryDate: "2026-09-01",
    lines: archanaLines,
    total: archanaTotal,
    prevBalance: 0,
    netDue: archanaTotal,
  });
  console.log("=== Archana Kakkar ===");
  console.log(`  total: 1646 -> ${archanaTotal}`);
  console.log(`\n${archanaMessage}\n`);

  // ---- Simran Kumar ----
  const simranLines: BillLineItem[] = [
    { productName: "Jumbo Blueberry", actualQty: 1, unitLabel: "Box", ratePerUnit: 330, amount: 330 },
  ];
  const simranTotal = 330;
  const simranPrevBalance = 1680;
  const simranNetDue = simranPrevBalance + simranTotal;
  const simranMessage = buildBillMessage({
    salutation: "Ma'am",
    deliveryDate: "2026-09-01",
    lines: simranLines,
    total: simranTotal,
    prevBalance: simranPrevBalance,
    netDue: simranNetDue,
  });
  console.log("=== Simran Kumar ===");
  console.log(`  total: 230 -> ${simranTotal}  net_due: 1910 -> ${simranNetDue}`);
  console.log(`\n${simranMessage}\n`);

  // ---- Rita Parkash ----
  const ritaLines: BillLineItem[] = [
    { productName: "Red Globe Grapes", actualQty: 0.58, unitLabel: "kg", ratePerUnit: 581.03, amount: 337 },
  ];
  const ritaTotal = 337;
  const ritaMessage = buildBillMessage({
    salutation: "Ma'am",
    deliveryDate: "2026-09-01",
    lines: ritaLines,
    total: ritaTotal,
    prevBalance: 0,
    netDue: ritaTotal,
  });
  console.log("=== Rita Parkash ===");
  console.log(`  total: 313 -> ${ritaTotal}`);
  console.log(`\n${ritaMessage}\n`);

  if (!EXECUTE) {
    console.log("Dry run only — pass --execute to write.");
    return;
  }

  // Archana Kakkar writes
  const { error: minigauvaErr } = await supabase
    .from("order_lines")
    .update({ actual_qty: 1.0 })
    .eq("id", "72d2e066-0813-4e5f-8160-a69540ae4e2e");
  if (minigauvaErr) throw new Error(`archana mini guava update failed: ${minigauvaErr.message}`);

  const { error: mandarinErr } = await supabase
    .from("order_lines")
    .update({ actual_qty: 1.03, locked_price_per_unit: 359.22 })
    .eq("id", "bab2c35d-6611-46c6-aec4-bb51e883fc60");
  if (mandarinErr) throw new Error(`archana mandarin orange update failed: ${mandarinErr.message}`);

  const { error: rggArchanaErr } = await supabase
    .from("order_lines")
    .update({ actual_qty: 0.6, locked_price_per_unit: 570 })
    .eq("id", "b28e3413-28ed-493a-a863-ca8cca83e3d0");
  if (rggArchanaErr) throw new Error(`archana red globe grapes update failed: ${rggArchanaErr.message}`);

  const { error: archanaBillErr } = await supabase
    .from("bills")
    .update({ total: archanaTotal, net_due: archanaTotal, message_text: archanaMessage })
    .eq("id", "3ce47f59-8d7a-4c10-afe6-fb7303b58cb4");
  if (archanaBillErr) throw new Error(`archana bill update failed: ${archanaBillErr.message}`);

  const { error: archanaDebitErr } = await supabase
    .from("ledger_entries")
    .update({ amount: archanaTotal })
    .eq("id", "df1adcf9-da6b-4576-bfe1-f2c80b411fc5");
  if (archanaDebitErr) throw new Error(`archana debit update failed: ${archanaDebitErr.message}`);

  const { error: archanaNoteErr } = await supabase
    .from("orders")
    .update({ notes: "Corrected 2026-09-14: Mini Guava, Mandarin Orange, and Red Globe Grapes qty/rate corrected per admin-supplied item breakdown." })
    .eq("id", "df98e49a-38f1-4db3-aad4-3f9c66a594b3");
  if (archanaNoteErr) throw new Error(`archana order note update failed: ${archanaNoteErr.message}`);

  console.log("Archana Kakkar corrected.");

  // Simran Kumar writes
  const { error: simranLineErr } = await supabase
    .from("order_lines")
    .update({ product_id: JUMBO_BLUEBERRY_ID, locked_price_per_unit: 330 })
    .eq("id", "fd6aeab3-0c76-4f87-b9e4-f23429ddcc54");
  if (simranLineErr) throw new Error(`simran line update failed: ${simranLineErr.message}`);

  const { error: simranBillErr } = await supabase
    .from("bills")
    .update({ total: simranTotal, net_due: simranNetDue, message_text: simranMessage })
    .eq("id", "5491e334-ff79-4db6-9d63-e4a59250efa4");
  if (simranBillErr) throw new Error(`simran bill update failed: ${simranBillErr.message}`);

  const { error: simranDebitErr } = await supabase
    .from("ledger_entries")
    .update({ amount: simranTotal })
    .eq("id", "e3a64219-b8e9-4573-ac70-60c0d1b8543d");
  if (simranDebitErr) throw new Error(`simran debit update failed: ${simranDebitErr.message}`);

  const { error: simranNoteErr } = await supabase
    .from("orders")
    .update({ notes: "Corrected 2026-09-14: line corrected from Normal Blueberry (₹230) to Jumbo Blueberry (₹330) per admin-supplied item breakdown." })
    .eq("id", "b28f2b42-55f5-475d-b86e-287e0517c9e9");
  if (simranNoteErr) throw new Error(`simran order note update failed: ${simranNoteErr.message}`);

  console.log("Simran Kumar corrected.");

  // Rita Parkash writes
  const { error: ritaLineErr } = await supabase
    .from("order_lines")
    .update({ locked_price_per_unit: 581.03 })
    .eq("id", "9baeebfb-b1e3-4aad-bf77-f2e113bd0af6");
  if (ritaLineErr) throw new Error(`rita line update failed: ${ritaLineErr.message}`);

  const { error: ritaBillErr } = await supabase
    .from("bills")
    .update({ total: ritaTotal, net_due: ritaTotal, message_text: ritaMessage })
    .eq("id", "a26985e6-3f07-4290-8567-068fc9bbfc9b");
  if (ritaBillErr) throw new Error(`rita bill update failed: ${ritaBillErr.message}`);

  const { error: ritaDebitErr } = await supabase
    .from("ledger_entries")
    .update({ amount: ritaTotal })
    .eq("id", "6fde1c4e-602d-41c2-a279-a11cdb2cd42a");
  if (ritaDebitErr) throw new Error(`rita debit update failed: ${ritaDebitErr.message}`);

  const { error: ritaNoteErr } = await supabase
    .from("orders")
    .update({ notes: "Corrected 2026-09-14: Red Globe Grapes rate corrected from ₹540/kg to ₹580/kg per admin-supplied item breakdown." })
    .eq("id", "7f354f75-f2b9-4977-aac9-94d9681abed1");
  if (ritaNoteErr) throw new Error(`rita order note update failed: ${ritaNoteErr.message}`);

  console.log("Rita Parkash corrected.");
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
