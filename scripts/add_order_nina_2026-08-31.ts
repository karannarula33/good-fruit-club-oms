// One-off: add Nina Sagar (new customer) + her missing Aug 31, 2026
// order, pasted via chat rather than the app's Order Entry screen.
//
// Run with: npx tsx --env-file=.env.local scripts/add_order_nina_2026-08-31.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { classifySalutation } from "../src/lib/parser/classify-salutation";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";

const EXECUTE = process.argv.includes("--execute");
const DELIVERY_DATE = "2026-08-31";
const PLACED_AT = "2026-08-31T09:00:00+05:30";

const CUSTOMER = {
  display_name: "Nina Sagar",
  phone: "9818715155",
  address: "Silver Oak Farms Number 11, Ghitorni Village, Mehrauli Gurgaon Road, Delhi",
  zone: "Outside Gurgaon" as const,
};

const MOON_DROPS_GRAPES_ID_LOOKUP = "Moon Drops Grapes"; // created in the 08-31 batch script — resolve by name
const POMEGRANATE_ID = "262e7251-9daf-44d9-9bfa-c8650e7f4a07";
const APPLE_NZ_ID = "d1126da0-8f19-4e8a-9eeb-c81063366113";
const RED_GLOBE_GRAPES_ID = "c21649a8-8022-49f3-a405-e8f51a1ef434";
const AVOCADO_ID = "7bcb08e8-6f5a-4ace-b8f9-82d0f884de69";
const DONUT_PEACHES_ID = "107485f1-e680-4611-a099-685d8e6e78a0";

const RAW_PASTE =
  "Nina Sagar – 98187 15155, Silver oak farms number 11, ghitorni village, Mehrauli Gurgaon road Delhi\n" +
  "0.55 kg Moon Drops Grapes @ ₹700 = ₹387\n" +
  "4.24 kg Anaar @ ₹380 = ₹1612\n" +
  "1 kg Apple (New Zealand) @ ₹460 = ₹460\n" +
  "0.53 kg Red Globe Grapes @ ₹540 = ₹286\n" +
  "6 pc Hass Avocado @ ₹170 = ₹1,020\n" +
  "4 Box Donut Peach @ ₹550 = ₹2200";

async function main() {
  const supabase = createServiceRoleClient();

  const { data: existingCustomer } = await supabase
    .from("customers")
    .select("id")
    .eq("phone", CUSTOMER.phone);
  if (existingCustomer && existingCustomer.length > 0) {
    throw new Error(`A customer with this phone already exists: ${existingCustomer.map((c) => c.id).join(", ")}`);
  }

  const { data: moonDrops, error: moonDropsError } = await supabase
    .from("products")
    .select("id")
    .eq("name", MOON_DROPS_GRAPES_ID_LOOKUP)
    .single();
  if (moonDropsError || !moonDrops) {
    throw new Error(`Could not find "${MOON_DROPS_GRAPES_ID_LOOKUP}" product — did the Aug 31 batch script run first?`);
  }
  const MOON_DROPS_GRAPES_ID = moonDrops.id;

  const salutationResult = await classifySalutation(CUSTOMER.display_name);
  if (salutationResult === "unknown") {
    throw new Error(`Salutation could not be classified for "${CUSTOMER.display_name}" — set manually.`);
  }
  const salutation = salutationResult;

  const lines = [
    { productId: MOON_DROPS_GRAPES_ID, productName: "Moon Drops Grapes", unitLabel: "kg", qty: 0.55, amount: 387 },
    { productId: POMEGRANATE_ID, productName: "Pomegranate (Anaar)", unitLabel: "kg", qty: 4.24, amount: 1612 },
    { productId: APPLE_NZ_ID, productName: "Apple (New Zealand)", unitLabel: "kg", qty: 1, amount: 460 },
    { productId: RED_GLOBE_GRAPES_ID, productName: "Red Globe Grapes", unitLabel: "kg", qty: 0.53, amount: 286 },
    { productId: AVOCADO_ID, productName: "Avocado", unitLabel: "Piece", qty: 6, amount: 1020 },
    { productId: DONUT_PEACHES_ID, productName: "Donut Peaches", unitLabel: "Box", qty: 4, amount: 2200 },
  ];
  const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const prevBalance = 0; // brand new customer
  const netDue = total;

  const billLines: BillLineItem[] = lines.map((l) => ({
    productName: l.productName,
    actualQty: l.qty,
    unitLabel: l.unitLabel,
    ratePerUnit: Math.round((l.amount / l.qty) * 100) / 100,
    amount: l.amount,
  }));
  const messageText = buildBillMessage({
    salutation,
    deliveryDate: DELIVERY_DATE,
    lines: billLines,
    total,
    prevBalance,
    netDue,
  });

  console.log("Plan:");
  console.log(`  new customer: Nina Sagar, ${CUSTOMER.phone}, zone=${CUSTOMER.zone}, salutation=${salutation}`);
  console.log(`  order total=₹${total}  payment=cash`);
  console.log(`\n--- message_text ---\n${messageText}\n---------------------\n`);

  if (!EXECUTE) {
    console.log("Dry run only — pass --execute to write.");
    return;
  }

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .insert(CUSTOMER)
    .select("id")
    .single();
  if (customerError) throw new Error(`customer insert failed: ${customerError.message}`);
  const { error: salutationError } = await supabase
    .from("customers")
    .update({ salutation })
    .eq("id", customer.id);
  if (salutationError) throw new Error(`salutation update failed: ${salutationError.message}`);

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      customer_id: customer.id,
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

  const lineRows = lines.map((l) => ({
    order_id: order.id,
    product_id: l.productId,
    ordered_qty: l.qty,
    ordered_unit: l.unitLabel,
    locked_price_per_unit: Math.round((l.amount / l.qty) * 100) / 100,
    actual_qty: l.qty,
    line_status: "packed" as const,
    is_substitution: false,
    parse_confidence: "clean" as const,
    parse_note: null,
  }));
  const { error: linesError } = await supabase.from("order_lines").insert(lineRows);
  if (linesError) throw new Error(`order_lines insert failed: ${linesError.message}`);

  const { error: billError } = await supabase.from("bills").insert({
    order_id: order.id,
    total,
    prev_balance: prevBalance,
    net_due: netDue,
    message_text: messageText,
    finalized_at: new Date().toISOString(),
  });
  if (billError) throw new Error(`bill insert failed: ${billError.message}`);

  const { error: debitError } = await supabase.from("ledger_entries").insert({
    customer_id: customer.id,
    entry_type: "debit",
    amount: total,
    order_id: order.id,
  });
  if (debitError) throw new Error(`debit insert failed: ${debitError.message}`);

  const { data: creditRow, error: creditError } = await supabase
    .from("ledger_entries")
    .insert({
      customer_id: customer.id,
      entry_type: "credit",
      amount: total,
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
    amount: total,
  });
  if (allocError) throw new Error(`allocation insert failed: ${allocError.message}`);

  console.log(`Done. customer=${customer.id} order=${order.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
