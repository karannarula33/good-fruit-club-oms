// One-off: add Rashmi Wadhwa's missing Aug 27, 2026 order (1 custom gift
// box, pasted via chat rather than the app's Order Entry screen). Verified
// no order already exists for this customer+date before writing this.
//
// Run with: npx tsx --env-file=.env.local scripts/add_order_rashmi_2026-08-27.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";

const EXECUTE = process.argv.includes("--execute");

const CUSTOMER_ID = "d00e488b-6bad-4920-9f54-36f2a75a1426"; // Rashmi Wadhwa
const DELIVERY_DATE = "2026-08-27";
const PLACED_AT = "2026-08-27T09:00:00+05:30";
const GIFT_BOX_NAME =
  "Gift Box – 2 Queen Apples, 2 Pears, 2 Malta, 1 Box Golden Kiwi, 2 Mangoes, 2 Avocados";
const BOX_PRICE = 2300;
const BOX_QTY = 1;
const PACKAGING_COST = 400;
const ORDER_TOTAL = BOX_PRICE * BOX_QTY;
const RAW_PASTE =
  "Rashmi Wadhwa – 9810621116, K 3/65, FF, DLF Phase 2, Gurgaon\n" +
  "2 queen apples - 184\n2 Pear - 140\n2 Malta - 112\n1 Box Golden Kiwi - 480\n" +
  "2 Mangoes - 650\n2 Avocados - 340\nGift Packing - 400 at 2300";

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
  const prevBalance = (ledger ?? []).reduce(
    (sum, e) => sum + (e.entry_type === "debit" ? e.amount : -e.amount),
    0,
  );
  const netDue = prevBalance + ORDER_TOTAL;

  const messageText =
    `Hello Ma'am,\n\n` +
    `Here's your Good Fruit Club bill for 27 Aug 2026:\n\n` +
    `${BOX_QTY}  ${GIFT_BOX_NAME} @ ₹${BOX_PRICE} = ₹${ORDER_TOTAL}\n\n` +
    `Order total: ₹${ORDER_TOTAL}\n` +
    `Previous balance: ₹${prevBalance.toFixed(2)}\n` +
    `Net amount due: ₹${netDue.toFixed(2)}\n\n` +
    `Pay via UPI: karannarula20@okhdfcbank\nor Cash on Delivery.\n\n` +
    `– Good Fruit Club`;

  console.log("Plan:");
  console.log(`  new product: "${GIFT_BOX_NAME}" (count/box)`);
  console.log(`  order: Rashmi Wadhwa, delivery_date=${DELIVERY_DATE}, 1 box @ ₹${BOX_PRICE} = ₹${ORDER_TOTAL}`);
  console.log(`  line packaging cost (internal): ₹${PACKAGING_COST}`);
  console.log(`  prev_balance=₹${prevBalance.toFixed(2)}  net_due=₹${netDue.toFixed(2)}`);
  console.log(`  ledger: debit ₹${ORDER_TOTAL}, credit ₹${ORDER_TOTAL} (cash), fully allocated`);
  console.log("\n--- message_text ---\n" + messageText + "\n---------------------\n");

  if (!EXECUTE) {
    console.log("Dry run only — pass --execute to write.");
    return;
  }

  const { data: product, error: productError } = await supabase
    .from("products")
    .insert({ name: GIFT_BOX_NAME, unit_type: "count", unit_label: "box", active: true })
    .select("id")
    .single();
  if (productError) throw new Error(`product insert failed: ${productError.message}`);

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
    product_id: product.id,
    ordered_qty: BOX_QTY,
    ordered_unit: "box",
    locked_price_per_unit: BOX_PRICE,
    actual_qty: BOX_QTY,
    line_status: "packed",
    is_substitution: false,
    parse_confidence: "clean",
    parse_note: null,
    is_gift_box: true,
    actual_packaging_cost: PACKAGING_COST,
  });
  if (lineError) throw new Error(`order_lines insert failed: ${lineError.message}`);

  const { error: billError } = await supabase.from("bills").insert({
    order_id: order.id,
    total: ORDER_TOTAL,
    prev_balance: prevBalance,
    net_due: netDue,
    message_text: messageText,
    finalized_at: nowIso,
  });
  if (billError) throw new Error(`bill insert failed: ${billError.message}`);

  const { error: debitError } = await supabase.from("ledger_entries").insert({
    customer_id: CUSTOMER_ID,
    entry_type: "debit",
    amount: ORDER_TOTAL,
    order_id: order.id,
  });
  if (debitError) throw new Error(`debit insert failed: ${debitError.message}`);

  const { data: creditRow, error: creditError } = await supabase
    .from("ledger_entries")
    .insert({
      customer_id: CUSTOMER_ID,
      entry_type: "credit",
      amount: ORDER_TOTAL,
      mode: "cash",
      order_id: null,
      note: "Paid in cash — order entered via chat with admin (backfilled 2026-09-14)",
    })
    .select("id")
    .single();
  if (creditError) throw new Error(`credit insert failed: ${creditError.message}`);

  const { error: allocError } = await supabase.from("payment_allocations").insert({
    ledger_entry_id: creditRow.id,
    order_id: order.id,
    amount: ORDER_TOTAL,
  });
  if (allocError) throw new Error(`allocation insert failed: ${allocError.message}`);

  console.log(`Done. order=${order.id} product=${product.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
