// One-off: add Rakesh Kapoor's missing Aug 27, 2026 order, pasted via
// chat rather than the app's Order Entry screen. Verified no order
// already exists for this customer+date before writing this.
//
// Run with: npx tsx --env-file=.env.local scripts/add_order_rakesh_2026-08-27.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";

const EXECUTE = process.argv.includes("--execute");

const CUSTOMER_ID = "e5808207-e053-4b4e-824d-d3fab98cf82d"; // Rakesh Kapoor
const DELIVERY_DATE = "2026-08-27";
const PLACED_AT = "2026-08-27T09:00:00+05:30";
const PRODUCT_ID = "f18e8b51-c603-4b62-b4a7-a9f5d407b627"; // Black Amber Plums, weight/kg
const QTY = 0.47;
const AMOUNT = 186;
const RATE = Math.round((AMOUNT / QTY) * 100) / 100;

const RAW_PASTE =
  "Rakesh Kapoor – 9935232333, M 8/14, DLF Phase 2, Second floor, Sector 25, Gurgaon 122002\n" +
  "0.47kg Black Amber Plums - ₹186";

async function main() {
  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase
    .from("orders")
    .select("id")
    .eq("customer_id", CUSTOMER_ID)
    .eq("delivery_date", DELIVERY_DATE);
  if (existing && existing.length > 0) {
    throw new Error(`Order already exists for this customer+date: ${existing.map((o) => o.id).join(", ")}`);
  }

  const { data: ledger } = await supabase
    .from("ledger_entries")
    .select("entry_type, amount")
    .eq("customer_id", CUSTOMER_ID);
  const prevBalance = Math.round(
    (ledger ?? []).reduce((sum, e) => sum + (e.entry_type === "debit" ? e.amount : -e.amount), 0) * 100,
  ) / 100;
  const netDue = Math.round((prevBalance + AMOUNT) * 100) / 100;

  const billLines: BillLineItem[] = [
    { productName: "Black Amber Plums", actualQty: QTY, unitLabel: "kg", ratePerUnit: RATE, amount: AMOUNT },
  ];
  const messageText = buildBillMessage({
    salutation: "Sir",
    deliveryDate: DELIVERY_DATE,
    lines: billLines,
    total: AMOUNT,
    prevBalance,
    netDue,
  });

  console.log("Plan:");
  console.log(`  order: Rakesh Kapoor, delivery_date=${DELIVERY_DATE}, 0.47kg Black Amber Plums @ ₹${RATE}/kg = ₹${AMOUNT}`);
  console.log(`  prev_balance=₹${prevBalance.toFixed(2)}  net_due=₹${netDue.toFixed(2)}`);
  console.log(`  ledger: debit ₹${AMOUNT}, credit ₹${AMOUNT} (upi), fully allocated`);
  console.log("\n--- message_text ---\n" + messageText + "\n---------------------\n");

  if (!EXECUTE) {
    console.log("Dry run only — pass --execute to write.");
    return;
  }

  const nowIso = new Date().toISOString();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      customer_id: CUSTOMER_ID,
      placed_at: PLACED_AT,
      delivery_date: DELIVERY_DATE,
      status: "delivered",
      status_timestamps: { delivered: PLACED_AT },
      raw_paste: RAW_PASTE,
      notes: null,
      is_historical: true,
      created_by: null,
    })
    .select("id")
    .single();
  if (orderError) throw new Error(`order insert failed: ${orderError.message}`);

  const { error: lineError } = await supabase.from("order_lines").insert({
    order_id: order.id,
    product_id: PRODUCT_ID,
    ordered_qty: QTY,
    ordered_unit: "kg",
    locked_price_per_unit: RATE,
    actual_qty: QTY,
    line_status: "packed",
    is_substitution: false,
    parse_confidence: "clean",
    parse_note: null,
  });
  if (lineError) throw new Error(`order_lines insert failed: ${lineError.message}`);

  const { error: billError } = await supabase.from("bills").insert({
    order_id: order.id,
    total: AMOUNT,
    prev_balance: prevBalance,
    net_due: netDue,
    message_text: messageText,
    finalized_at: nowIso,
  });
  if (billError) throw new Error(`bill insert failed: ${billError.message}`);

  const { error: debitError } = await supabase.from("ledger_entries").insert({
    customer_id: CUSTOMER_ID,
    entry_type: "debit",
    amount: AMOUNT,
    order_id: order.id,
  });
  if (debitError) throw new Error(`debit insert failed: ${debitError.message}`);

  const { data: creditRow, error: creditError } = await supabase
    .from("ledger_entries")
    .insert({
      customer_id: CUSTOMER_ID,
      entry_type: "credit",
      amount: AMOUNT,
      mode: "upi",
      order_id: null,
      note: "Paid via UPI — order entered via chat with admin (backfilled 2026-09-14)",
    })
    .select("id")
    .single();
  if (creditError) throw new Error(`credit insert failed: ${creditError.message}`);

  const { error: allocError } = await supabase.from("payment_allocations").insert({
    ledger_entry_id: creditRow.id,
    order_id: order.id,
    amount: AMOUNT,
  });
  if (allocError) throw new Error(`allocation insert failed: ${allocError.message}`);

  console.log(`Done. order=${order.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
