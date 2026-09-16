// Corrects Swatee's live-app Sep 10, 2026 order (ef03f9d1). The OMS bill
// was missing one line entirely — Custard Apple 0.6 kg @ ₹450 = ₹270 —
// so the order billed ₹1,371 instead of the correct ₹1,641. Admin
// supplied the authoritative 5-line breakdown; the other 4 lines already
// matched (only the Yellaki Banana unit label is tidied from the stored
// "piece" to the weight it was billed at, "kg", per the same
// weight-vs-count pattern seen in the Sep 9 corrections).
//
// The order's single ledger debit (df754226) is plain/unpaid — no payment
// allocation points at this order — so the bill total AND the debit are
// safe to adjust together (verified read-only before writing).
//
// Effect: add Custard Apple line; bill total 1371 -> 1641; net_due
// 3437 -> 3707 (prev_balance 2066 unchanged); debit 1371 -> 1641.
//
// Run with: npx tsx --env-file=.env.local scripts/correct_sep10_swatee.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";
import { roundLineAmount } from "../src/lib/billing/compute";

const EXECUTE = process.argv.includes("--execute");

const ORDER_ID = "ef03f9d1-45aa-48ea-b6c4-ff3583416297";
const BILL_ID = "d4d058e3-1b75-44bb-a7f0-323a45a7a76d";
const DEBIT_ID = "df754226-db08-4810-aacb-5a46f7b40b26";
const YELLAKI_LINE_ID = "4166277c-152e-41c9-b6f7-deae02e99899";
const CUSTARD_APPLE_PRODUCT_ID = "0cb7119c-4ee4-471d-a4ed-34c79791ac32";

const PREV_BALANCE = 2066;
const SALUTATION = "Ma'am";
const DELIVERY_DATE = "2026-09-10";

type Spec = { productName: string; qty: number; unitLabel: string; rate: number };
const SPECS: Spec[] = [
  { productName: "Pomegranate", qty: 2.16, unitLabel: "kg", rate: 390 },
  { productName: "Red Globe Grapes", qty: 0.52, unitLabel: "kg", rate: 580 },
  { productName: "Yellaki (Elaichi) Banana", qty: 0.2, unitLabel: "kg", rate: 300 },
  { productName: "Papaya", qty: 1.11, unitLabel: "kg", rate: 150 },
  { productName: "Custard Apple", qty: 0.6, unitLabel: "kg", rate: 450 },
];

async function main() {
  const supabase = createServiceRoleClient();

  const lines: BillLineItem[] = SPECS.map((s) => ({
    productName: s.productName,
    actualQty: s.qty,
    unitLabel: s.unitLabel,
    ratePerUnit: s.rate,
    amount: roundLineAmount(s.qty, s.rate),
  }));
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  const netDue = PREV_BALANCE + total;

  const message = buildBillMessage({
    salutation: SALUTATION,
    deliveryDate: DELIVERY_DATE,
    lines,
    total,
    prevBalance: PREV_BALANCE,
    netDue,
  });

  console.log("=== Swatee — Sep 10 correction ===");
  console.log("  + ADD Custard Apple 0.6 kg @ ₹450 = ₹270 (was missing)");
  console.log("  ~ Yellaki Banana unit label: piece -> kg (billing unchanged)");
  console.log(`  total: 1371 -> ${total}`);
  console.log(`  net_due: 3437 -> ${netDue} (prev_balance ${PREV_BALANCE})`);
  console.log(`  debit df754226: 1371 -> ${total}`);
  console.log(`\n${message}\n`);

  if (total !== 1641) throw new Error(`Expected total 1641, computed ${total} — aborting.`);

  if (!EXECUTE) {
    console.log("Dry run only — pass --execute to write.");
    return;
  }

  // 1. Tidy Yellaki Banana unit label (billing values already correct).
  const { error: yErr } = await supabase
    .from("order_lines")
    .update({ ordered_unit: "kg" })
    .eq("id", YELLAKI_LINE_ID);
  if (yErr) throw new Error(`yellaki line update failed: ${yErr.message}`);

  // 2. Insert the missing Custard Apple line.
  const { error: insErr } = await supabase.from("order_lines").insert({
    order_id: ORDER_ID,
    product_id: CUSTARD_APPLE_PRODUCT_ID,
    ordered_qty: 0.6,
    ordered_unit: "kg",
    locked_price_per_unit: 450,
    actual_qty: 0.6,
    line_status: "packed",
    is_substitution: false,
    parse_confidence: "clean",
  });
  if (insErr) throw new Error(`custard apple line insert failed: ${insErr.message}`);

  // 3. Update the bill.
  const { error: billErr } = await supabase
    .from("bills")
    .update({ total, net_due: netDue, message_text: message })
    .eq("id", BILL_ID);
  if (billErr) throw new Error(`bill update failed: ${billErr.message}`);

  // 4. Update the (unpaid) ledger debit.
  const { error: debitErr } = await supabase
    .from("ledger_entries")
    .update({ amount: total })
    .eq("id", DEBIT_ID);
  if (debitErr) throw new Error(`debit update failed: ${debitErr.message}`);

  console.log("Swatee Sep 10 order corrected.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
