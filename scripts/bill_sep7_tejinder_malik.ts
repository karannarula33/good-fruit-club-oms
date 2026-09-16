// Bills Tejinder Malik's Sep 7, 2026 order for the first time — it was
// packed but never billed. Admin says it's a free replacement (2.5kg
// Malta, ₹0) for a previous order she complained wasn't juicy. The
// existing line had a placeholder locked_price_per_unit of ₹1 (clearly
// wrong, never resolved) — corrected to ₹0, qty set to the stated 2.5kg.
// Also corrects customers.salutation Sir -> Ma'am (admin referred to her
// as "her"/"she" — the stored value looks wrong).
//
// Run with: npx tsx --env-file=.env.local scripts/bill_sep7_tejinder_malik.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";

const EXECUTE = process.argv.includes("--execute");

const CUSTOMER_ID = "986c9020-cd82-4cd4-a717-aff71ed8e044";
const ORDER_ID = "dccadbec-ac2b-4d0d-a0cd-2bb83285c9b3";
const LINE_ID = "8b6157e4-f73d-4a4c-83ce-f41879c4437a";
// A bill already existed (created live on 2026-09-07, total=₹3, wrong
// price never fixed) — discovered mid-run when the insert hit the unique
// constraint. Correcting in place instead of inserting.
const EXISTING_BILL_ID = "a2c15d59-f2f3-4b8c-a141-ffd3ae8f6352";
const EXISTING_DEBIT_ID = "377619c5-8cc2-4aa0-b410-0558a5034e1b";
const PREV_BALANCE = 700; // matches the existing bill's own prev_balance

async function main() {
  const supabase = createServiceRoleClient();

  const lines: BillLineItem[] = [
    { productName: "Malta", actualQty: 2.5, unitLabel: "kg", ratePerUnit: 0, amount: 0 },
  ];
  const total = 0;
  const netDue = PREV_BALANCE;
  const messageText = buildBillMessage({
    salutation: "Ma'am",
    deliveryDate: "2026-09-07",
    lines,
    total,
    prevBalance: PREV_BALANCE,
    netDue,
  });

  console.log("=== Tejinder Malik ===");
  console.log(`  salutation: Sir -> Ma'am [already applied]`);
  console.log(`  line: qty 2.547 -> 2.5kg, price 1 -> 0 [already applied]`);
  console.log(`  existing bill total ₹3 -> ₹0, existing ₹3 debit removed`);
  console.log(`\n${messageText}\n`);

  if (!EXECUTE) {
    console.log("Dry run only — pass --execute to write.");
    return;
  }

  const { error: billError } = await supabase
    .from("bills")
    .update({
      total,
      prev_balance: PREV_BALANCE,
      net_due: netDue,
      message_text: messageText,
    })
    .eq("id", EXISTING_BILL_ID);
  if (billError) throw new Error(`bill update failed: ${billError.message}`);

  const { error: debitDelError } = await supabase.from("ledger_entries").delete().eq("id", EXISTING_DEBIT_ID);
  if (debitDelError) throw new Error(`debit delete failed: ${debitDelError.message}`);

  const { error: noteError } = await supabase
    .from("orders")
    .update({ notes: "Free replacement for a previous 2.5kg Malta order she complained wasn't very juicy. Billed at ₹0." })
    .eq("id", ORDER_ID);
  if (noteError) throw new Error(`order note update failed: ${noteError.message}`);

  console.log("Tejinder Malik billed.\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
