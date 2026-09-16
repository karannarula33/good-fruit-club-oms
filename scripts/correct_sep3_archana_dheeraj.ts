// Corrects two live-app Sep 3, 2026 orders per admin-supplied item
// breakdown. Both orders have exactly one plain (unpaid, no matching
// credit) ledger debit tied to them via order_id — safe to adjust.
//
//   - Archana Kakkar: Pusa Mango actual_qty corrected 1.03 -> 1.0kg to
//     match the admin's stated ₹750 (was ₹773). total 773 -> 750.
//   - Dheeraj Kapoor: Pomegranate qty/rate corrected (2.161kg @ ₹380 ->
//     2.16kg @ ₹390); everything else already matched. total 3954 -> 3976.
//
// Run with: npx tsx --env-file=.env.local scripts/correct_sep3_archana_dheeraj.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";

const EXECUTE = process.argv.includes("--execute");

const ARCHANA_ORDER_ID = "480df95f-2835-4551-bdf1-cca640ef7e34";
const ARCHANA_BILL_ID = "f864614a-7234-46e8-b16f-4c9cf02a185b";
const ARCHANA_DEBIT_ID = "bc4ed7a9-d0e4-4253-b33c-6fa7a46cb0b0";
const ARCHANA_LINE_ID = "d3bd2df2-90a5-4149-8038-3a08c648badf";
const ARCHANA_PREV_BALANCE = 2196;

const DHEERAJ_ORDER_ID = "68c9a3d9-8932-4217-a956-f17091ef7ada";
const DHEERAJ_BILL_ID = "5f5e92e7-f543-4ab4-b408-4ff5fca0a6b9";
const DHEERAJ_DEBIT_ID = "d9c3ee1e-e31e-4282-9faf-73d57d30175d";
const DHEERAJ_POMEGRANATE_LINE_ID = "f1e2f943-dc58-44f0-a3d6-843bd21de0cc";
const DHEERAJ_PREV_BALANCE = 1100.7;

async function main() {
  const supabase = createServiceRoleClient();

  // ---- Archana Kakkar ----
  const archanaLines: BillLineItem[] = [
    { productName: "Pusa Mango – 1 kg", actualQty: 1.0, unitLabel: "kg", ratePerUnit: 750, amount: 750 },
  ];
  const archanaTotal = 750;
  const archanaNetDue = Math.round((ARCHANA_PREV_BALANCE + archanaTotal) * 100) / 100;
  const archanaMessage = buildBillMessage({
    salutation: "Ma'am",
    deliveryDate: "2026-09-03",
    lines: archanaLines,
    total: archanaTotal,
    prevBalance: ARCHANA_PREV_BALANCE,
    netDue: archanaNetDue,
  });
  console.log("=== Archana Kakkar ===");
  console.log(`  total: 773 -> ${archanaTotal}  net_due -> ${archanaNetDue}`);
  console.log(`\n${archanaMessage}\n`);

  // ---- Dheeraj Kapoor ----
  const dheerajLines: BillLineItem[] = [
    { productName: "Nectarines", actualQty: 1, unitLabel: "box", ratePerUnit: 580, amount: 580 },
    { productName: "Apple (New Zealand)", actualQty: 2, unitLabel: "kg", ratePerUnit: 460, amount: 920 },
    { productName: "Pomegranate", actualQty: 2.16, unitLabel: "kg", ratePerUnit: 390, amount: 843 },
    { productName: "Red Globe Grapes", actualQty: 1.068, unitLabel: "kg", ratePerUnit: 540, amount: 577 },
    { productName: "Sun Melon", actualQty: 1.8, unitLabel: "kg", ratePerUnit: 220, amount: 396 },
    { productName: "Jumbo Blueberry", actualQty: 2, unitLabel: "Box", ratePerUnit: 330, amount: 660 },
  ];
  const dheerajTotal = dheerajLines.reduce((s, l) => s + l.amount, 0);
  const dheerajNetDue = Math.round((DHEERAJ_PREV_BALANCE + dheerajTotal) * 100) / 100;
  const dheerajMessage = buildBillMessage({
    salutation: "Sir",
    deliveryDate: "2026-09-03",
    lines: dheerajLines,
    total: dheerajTotal,
    prevBalance: DHEERAJ_PREV_BALANCE,
    netDue: dheerajNetDue,
  });
  console.log("=== Dheeraj Kapoor ===");
  console.log(`  total: 3954 -> ${dheerajTotal}  net_due -> ${dheerajNetDue}`);
  console.log(`\n${dheerajMessage}\n`);

  if (!EXECUTE) {
    console.log("Dry run only — pass --execute to write.");
    return;
  }

  // Archana Kakkar writes
  const { error: archanaLineErr } = await supabase
    .from("order_lines")
    .update({ actual_qty: 1.0 })
    .eq("id", ARCHANA_LINE_ID);
  if (archanaLineErr) throw new Error(`archana line update failed: ${archanaLineErr.message}`);

  const { error: archanaBillErr } = await supabase
    .from("bills")
    .update({ total: archanaTotal, net_due: archanaNetDue, message_text: archanaMessage })
    .eq("id", ARCHANA_BILL_ID);
  if (archanaBillErr) throw new Error(`archana bill update failed: ${archanaBillErr.message}`);

  const { error: archanaDebitErr } = await supabase
    .from("ledger_entries")
    .update({ amount: archanaTotal })
    .eq("id", ARCHANA_DEBIT_ID);
  if (archanaDebitErr) throw new Error(`archana debit update failed: ${archanaDebitErr.message}`);

  const { error: archanaNoteErr } = await supabase
    .from("orders")
    .update({ notes: "Corrected 2026-09-14: Pusa Mango qty corrected from 1.03kg to 1.0kg per admin-supplied item breakdown." })
    .eq("id", ARCHANA_ORDER_ID);
  if (archanaNoteErr) throw new Error(`archana order note update failed: ${archanaNoteErr.message}`);

  console.log("Archana Kakkar corrected.");

  // Dheeraj Kapoor writes
  const { error: dheerajLineErr } = await supabase
    .from("order_lines")
    .update({ actual_qty: 2.16, locked_price_per_unit: 390 })
    .eq("id", DHEERAJ_POMEGRANATE_LINE_ID);
  if (dheerajLineErr) throw new Error(`dheeraj line update failed: ${dheerajLineErr.message}`);

  const { error: dheerajBillErr } = await supabase
    .from("bills")
    .update({ total: dheerajTotal, net_due: dheerajNetDue, message_text: dheerajMessage })
    .eq("id", DHEERAJ_BILL_ID);
  if (dheerajBillErr) throw new Error(`dheeraj bill update failed: ${dheerajBillErr.message}`);

  const { error: dheerajDebitErr } = await supabase
    .from("ledger_entries")
    .update({ amount: dheerajTotal })
    .eq("id", DHEERAJ_DEBIT_ID);
  if (dheerajDebitErr) throw new Error(`dheeraj debit update failed: ${dheerajDebitErr.message}`);

  const { error: dheerajNoteErr } = await supabase
    .from("orders")
    .update({ notes: "Corrected 2026-09-14: Pomegranate qty/rate corrected (2.161kg @ ₹380 -> 2.16kg @ ₹390) per admin-supplied item breakdown." })
    .eq("id", DHEERAJ_ORDER_ID);
  if (dheerajNoteErr) throw new Error(`dheeraj order note update failed: ${dheerajNoteErr.message}`);

  console.log("Dheeraj Kapoor corrected.");
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
