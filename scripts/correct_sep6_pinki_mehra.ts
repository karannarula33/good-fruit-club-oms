// Corrects Pinki Mehra's live-app Sep 6, 2026 order — actual_qty
// corrected 3.05 -> 3.0kg per admin. Order has exactly one plain (unpaid,
// no matching credit) ledger debit — safe to adjust in place.
// total 1403 -> 1380.
//
// Run with: npx tsx --env-file=.env.local scripts/correct_sep6_pinki_mehra.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";

const EXECUTE = process.argv.includes("--execute");

const ORDER_ID = "5990340b-7298-4ea4-9132-015c03301ff4";
const BILL_ID = "04e678e0-ac04-4fa7-8540-fed6dbd85fa2";
const DEBIT_ID = "d4e5b3a2-2452-417d-a317-29f30e87d589";
const LINE_ID = "5e10b78e-abe3-45e3-97f9-a292a5869e91";
const PREV_BALANCE = 2454.46;

async function main() {
  const supabase = createServiceRoleClient();

  const lines: BillLineItem[] = [
    { productName: "Apple (New Zealand)", actualQty: 3, unitLabel: "kg", ratePerUnit: 460, amount: 1380 },
  ];
  const total = 1380;
  const netDue = Math.round((PREV_BALANCE + total) * 100) / 100;
  const messageText = buildBillMessage({
    salutation: "Ma'am",
    deliveryDate: "2026-09-06",
    lines,
    total,
    prevBalance: PREV_BALANCE,
    netDue,
  });

  console.log("=== Pinki Mehra ===");
  console.log(`  qty: 3.05 -> 3.0kg  total: 1403 -> ${total}  net_due -> ${netDue}`);
  console.log(`\n${messageText}\n`);

  if (!EXECUTE) {
    console.log("Dry run only — pass --execute to write.");
    return;
  }

  const { error: lineError } = await supabase.from("order_lines").update({ actual_qty: 3 }).eq("id", LINE_ID);
  if (lineError) throw new Error(`line update failed: ${lineError.message}`);

  const { error: billError } = await supabase
    .from("bills")
    .update({ total, net_due: netDue, message_text: messageText })
    .eq("id", BILL_ID);
  if (billError) throw new Error(`bill update failed: ${billError.message}`);

  const { error: debitError } = await supabase.from("ledger_entries").update({ amount: total }).eq("id", DEBIT_ID);
  if (debitError) throw new Error(`debit update failed: ${debitError.message}`);

  const { error: noteError } = await supabase
    .from("orders")
    .update({ notes: "Corrected 2026-09-14: Apple (New Zealand) qty corrected from 3.05kg to 3.0kg per admin-supplied item breakdown." })
    .eq("id", ORDER_ID);
  if (noteError) throw new Error(`order note update failed: ${noteError.message}`);

  console.log("Pinki Mehra corrected.\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
