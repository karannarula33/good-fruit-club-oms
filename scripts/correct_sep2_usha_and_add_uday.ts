// Two Sep 2, 2026 corrections/additions per admin:
//   - Usha Bhatia: remove the stray Sun Melon line (looks like a parser
//     error — "Sun Melon – 1 pc" got recorded as 1.867kg/₹355, not in the
//     admin's corrected item list at all). total 1791 -> 1436, now paid
//     in cash.
//   - Uday Marya: new customer + new order, ₹990 Mangosteen, paid via
//     Razorpay/online.
//
// Run with: npx tsx --env-file=.env.local scripts/correct_sep2_usha_and_add_uday.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { classifySalutation } from "../src/lib/parser/classify-salutation";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";

const EXECUTE = process.argv.includes("--execute");

// ---- Usha Bhatia ----
const USHA_CUSTOMER_ID = "1d9975e1-7e5f-4ac1-b27c-3e8f4a9365b0";
const USHA_ORDER_ID = "81429241-8b7c-4acd-bd41-6d565c7214f6";
const USHA_BILL_ID = "3d0c6495-017a-48d6-a014-93188b490e9d";
const USHA_DEBIT_ID = "7add248b-6d09-49f9-b487-3c565f279b37";
const SUN_MELON_LINE_ID = "663e7047-855a-4440-bf08-63cdfaa9bbf3";
const USHA_PREV_BALANCE = 1109.7;

// ---- Uday Marya ----
const UDAY_CUSTOMER = {
  display_name: "Uday Marya",
  phone: "9811404005",
  address: "W 31, First Floor, Greater Kailash 1",
  zone: "Outside Gurgaon" as const,
  notes: "Email: udaymarya@gmail.com",
};
const MANGOSTEEN_ID = "f2fa42ac-8d1a-45b7-a232-845e2759cd85";
const DELIVERY_DATE = "2026-09-02";
const PLACED_AT = "2026-09-02T09:00:00+05:30";

async function main() {
  const supabase = createServiceRoleClient();

  // ---- Usha Bhatia plan ----
  const ushaLines: BillLineItem[] = [
    { productName: "Sweet Sapphire Grapes", actualQty: 0.54, unitLabel: "kg", ratePerUnit: 800, amount: 432 },
    { productName: "Pomegranate", actualQty: 1.1, unitLabel: "kg", ratePerUnit: 380, amount: 418 },
    { productName: "Mausmi", actualQty: 0.842, unitLabel: "kg", ratePerUnit: 150, amount: 126 },
    { productName: "Apple (New Zealand)", actualQty: 1, unitLabel: "kg", ratePerUnit: 460, amount: 460 },
  ];
  const ushaTotal = ushaLines.reduce((s, l) => s + l.amount, 0);
  const ushaNetDue = Math.round((USHA_PREV_BALANCE + ushaTotal) * 100) / 100;
  const ushaMessage = buildBillMessage({
    salutation: "Ma'am",
    deliveryDate: "2026-09-02",
    lines: ushaLines,
    total: ushaTotal,
    prevBalance: USHA_PREV_BALANCE,
    netDue: ushaNetDue,
  });
  console.log("=== Usha Bhatia ===");
  console.log(`  remove Sun Melon line; total: 1791 -> ${ushaTotal}; net_due -> ${ushaNetDue}`);
  console.log(`  now paid in cash`);
  console.log(`\n${ushaMessage}\n`);

  // ---- Uday Marya plan ----
  const salutationResult = await classifySalutation(UDAY_CUSTOMER.display_name);
  const salutation = salutationResult === "unknown" ? null : salutationResult;
  if (!salutation) console.log(`WARNING: salutation could not be classified for Uday Marya — set manually.`);

  const udayLines: BillLineItem[] = [
    { productName: "Mangosteen", actualQty: 1, unitLabel: "kg", ratePerUnit: 990, amount: 990 },
  ];
  const udayTotal = 990;
  const udayMessage = salutation
    ? buildBillMessage({
        salutation,
        deliveryDate: DELIVERY_DATE,
        lines: udayLines,
        total: udayTotal,
        prevBalance: 0,
        netDue: udayTotal,
      })
    : null;
  console.log("=== Uday Marya (new customer) ===");
  console.log(`  ${UDAY_CUSTOMER.phone}, ${UDAY_CUSTOMER.address}, zone=${UDAY_CUSTOMER.zone}, salutation=${salutation}`);
  console.log(`  total=₹${udayTotal}, paid online`);
  if (udayMessage) console.log(`\n${udayMessage}\n`);

  if (!EXECUTE) {
    console.log("Dry run only — pass --execute to write.");
    return;
  }
  if (!salutation) throw new Error("Cannot execute: Uday Marya's salutation is unresolved.");

  // Usha Bhatia writes
  const { error: sunMelonDelError } = await supabase.from("order_lines").delete().eq("id", SUN_MELON_LINE_ID);
  if (sunMelonDelError) throw new Error(`sun melon line delete failed: ${sunMelonDelError.message}`);

  const { error: ushaBillError } = await supabase
    .from("bills")
    .update({ total: ushaTotal, net_due: ushaNetDue, message_text: ushaMessage })
    .eq("id", USHA_BILL_ID);
  if (ushaBillError) throw new Error(`usha bill update failed: ${ushaBillError.message}`);

  const { error: ushaDebitError } = await supabase
    .from("ledger_entries")
    .update({ amount: ushaTotal })
    .eq("id", USHA_DEBIT_ID);
  if (ushaDebitError) throw new Error(`usha debit update failed: ${ushaDebitError.message}`);

  const { data: ushaCreditRow, error: ushaCreditError } = await supabase
    .from("ledger_entries")
    .insert({
      customer_id: USHA_CUSTOMER_ID,
      entry_type: "credit",
      amount: ushaTotal,
      mode: "cash",
      order_id: null,
      note: "Paid in cash — order entered via chat with admin (backfilled 2026-09-14)",
    })
    .select("id")
    .single();
  if (ushaCreditError) throw new Error(`usha credit insert failed: ${ushaCreditError.message}`);

  const { error: ushaAllocError } = await supabase.from("payment_allocations").insert({
    ledger_entry_id: ushaCreditRow.id,
    order_id: USHA_ORDER_ID,
    amount: ushaTotal,
  });
  if (ushaAllocError) throw new Error(`usha allocation insert failed: ${ushaAllocError.message}`);

  const { error: ushaNoteError } = await supabase
    .from("orders")
    .update({ notes: "Corrected 2026-09-14: removed stray Sun Melon line (parser error, not in admin-supplied item list)." })
    .eq("id", USHA_ORDER_ID);
  if (ushaNoteError) throw new Error(`usha order note update failed: ${ushaNoteError.message}`);

  console.log("Usha Bhatia corrected.");

  // Uday Marya writes
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .insert(UDAY_CUSTOMER)
    .select("id")
    .single();
  if (customerError) throw new Error(`uday customer insert failed: ${customerError.message}`);

  const { error: salutationError } = await supabase
    .from("customers")
    .update({ salutation })
    .eq("id", customer.id);
  if (salutationError) throw new Error(`uday salutation update failed: ${salutationError.message}`);

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      customer_id: customer.id,
      placed_at: PLACED_AT,
      delivery_date: DELIVERY_DATE,
      status: "delivered",
      status_timestamps: { delivered: PLACED_AT },
      raw_paste: "Uday Marya – 9811404005, W 31, First Floor, Greater Kailash 1\n1 kg Mangosteen @ ₹990 = ₹990",
      notes: null,
      is_historical: true,
      created_by: null,
    })
    .select("id")
    .single();
  if (orderError) throw new Error(`uday order insert failed: ${orderError.message}`);

  const { error: lineError } = await supabase.from("order_lines").insert({
    order_id: order.id,
    product_id: MANGOSTEEN_ID,
    ordered_qty: 1,
    ordered_unit: "kg",
    locked_price_per_unit: 990,
    actual_qty: 1,
    line_status: "packed",
    is_substitution: false,
    parse_confidence: "clean",
    parse_note: null,
  });
  if (lineError) throw new Error(`uday order_lines insert failed: ${lineError.message}`);

  const { error: billError } = await supabase.from("bills").insert({
    order_id: order.id,
    total: udayTotal,
    prev_balance: 0,
    net_due: udayTotal,
    message_text: udayMessage!,
    finalized_at: new Date().toISOString(),
  });
  if (billError) throw new Error(`uday bill insert failed: ${billError.message}`);

  const { error: debitError } = await supabase.from("ledger_entries").insert({
    customer_id: customer.id,
    entry_type: "debit",
    amount: udayTotal,
    order_id: order.id,
  });
  if (debitError) throw new Error(`uday debit insert failed: ${debitError.message}`);

  const { data: udayCreditRow, error: udayCreditError } = await supabase
    .from("ledger_entries")
    .insert({
      customer_id: customer.id,
      entry_type: "credit",
      amount: udayTotal,
      mode: "other",
      order_id: null,
      note: "Paid via Razorpay/online — order entered via chat with admin (backfilled 2026-09-14)",
    })
    .select("id")
    .single();
  if (udayCreditError) throw new Error(`uday credit insert failed: ${udayCreditError.message}`);

  const { error: udayAllocError } = await supabase.from("payment_allocations").insert({
    ledger_entry_id: udayCreditRow.id,
    order_id: order.id,
    amount: udayTotal,
  });
  if (udayAllocError) throw new Error(`uday allocation insert failed: ${udayAllocError.message}`);

  console.log(`Uday Marya done. customer=${customer.id} order=${order.id}`);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
