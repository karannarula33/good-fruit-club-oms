// Corrects SC Keswani's live-app Sep 4, 2026 order — 5 of 6 items already
// matched exactly, but the order was missing a "Good staples Atta" line
// (500g @ ₹180) entirely. Order has exactly one plain (unpaid, no
// matching credit) ledger debit — safe to adjust in place.
// total 2634 -> 2814.
//
// Run with: npx tsx --env-file=.env.local scripts/correct_sep4_sc_keswani.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";

const EXECUTE = process.argv.includes("--execute");

const ORDER_ID = "e6a886bf-3846-4460-8fc8-905fe0552941";
const BILL_ID = "ab00af23-da4b-4dab-8085-ad25043f8386";
const DEBIT_ID = "b83acf8c-8e27-42c7-92e4-92ace9e2aa1d";
const CUSTOMER_ID = "802b796f-ec50-4f7d-a32c-4f37d56be60e";
const ATTA_PRODUCT_ID = "39f71eac-c500-4ce6-ac33-5d15b53e2e2a";
const PREV_BALANCE = 897.6;

async function main() {
  const supabase = createServiceRoleClient();

  const lines: BillLineItem[] = [
    { productName: "Pusa Mango – 1 kg", actualQty: 1.105, unitLabel: "kg", ratePerUnit: 750, amount: 829 },
    { productName: "Mausmi", actualQty: 1.06, unitLabel: "kg", ratePerUnit: 150, amount: 159 },
    { productName: "Custard Apple", actualQty: 1.152, unitLabel: "kg", ratePerUnit: 450, amount: 518 },
    { productName: "Pomegranate", actualQty: 1.126, unitLabel: "kg", ratePerUnit: 390, amount: 439 },
    { productName: "Malta", actualQty: 2.61, unitLabel: "kg", ratePerUnit: 264, amount: 689 },
    { productName: "Good staples Atta", actualQty: 0.5, unitLabel: "kg", ratePerUnit: 360, amount: 180 },
  ];
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const netDue = Math.round((PREV_BALANCE + total) * 100) / 100;
  const messageText = buildBillMessage({
    salutation: "Ma'am",
    deliveryDate: "2026-09-04",
    lines,
    total,
    prevBalance: PREV_BALANCE,
    netDue,
  });

  console.log("=== SC Keswani ===");
  console.log(`  add line: Good staples Atta 0.5kg @ ₹360/kg = ₹180`);
  console.log(`  total: 2634 -> ${total}  net_due -> ${netDue}`);
  console.log(`\n${messageText}\n`);

  if (!EXECUTE) {
    console.log("Dry run only — pass --execute to write.");
    return;
  }

  const { error: lineError } = await supabase.from("order_lines").insert({
    order_id: ORDER_ID,
    product_id: ATTA_PRODUCT_ID,
    ordered_qty: 0.5,
    ordered_unit: "kg",
    locked_price_per_unit: 360,
    actual_qty: 0.5,
    line_status: "packed",
    is_substitution: false,
    parse_confidence: "clean",
    parse_note: null,
  });
  if (lineError) throw new Error(`line insert failed: ${lineError.message}`);

  const { error: billError } = await supabase
    .from("bills")
    .update({ total, net_due: netDue, message_text: messageText })
    .eq("id", BILL_ID);
  if (billError) throw new Error(`bill update failed: ${billError.message}`);

  const { error: debitError } = await supabase
    .from("ledger_entries")
    .update({ amount: total })
    .eq("id", DEBIT_ID);
  if (debitError) throw new Error(`debit update failed: ${debitError.message}`);

  const { error: noteError } = await supabase
    .from("orders")
    .update({ notes: "Corrected 2026-09-14: added missing Good staples Atta line (500g, ₹180) per admin-supplied item breakdown." })
    .eq("id", ORDER_ID);
  if (noteError) throw new Error(`order note update failed: ${noteError.message}`);

  console.log("SC Keswani corrected.\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
