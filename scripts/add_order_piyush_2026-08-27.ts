// One-off: add Piyush Soni's missing Aug 27, 2026 order, pasted via chat
// rather than the app's Order Entry screen. Verified no order already
// exists for this customer+date before writing this.
//
// Two of the line rates are backed out from the user's stated per-line
// amount (qty * @rate doesn't quite match the amount given — small
// rounding on Grapes lines) so the stored total matches exactly what was
// actually billed (₹2817), per CLAUDE.md's money-logic rigor.
//
// Run with: npx tsx --env-file=.env.local scripts/add_order_piyush_2026-08-27.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";

const EXECUTE = process.argv.includes("--execute");

const CUSTOMER_ID = "95640362-b7b6-4db4-9a4d-27616b6075f4"; // Piyush Soni
const DELIVERY_DATE = "2026-08-27";
const PLACED_AT = "2026-08-27T09:00:00+05:30";

const RED_GLOBE_GRAPES_ID = "c21649a8-8022-49f3-a405-e8f51a1ef434"; // weight/kg
const MUSCAT_GRAPES_ID = "2632f82d-1788-4b18-a4f3-8f8486028759"; // catalog count/Box, used as weight here
const DONUT_PEACHES_ID = "107485f1-e680-4611-a099-685d8e6e78a0"; // count/Box
const RED_DRAGON_FRUIT_ID = "b92b6d90-81be-4608-ab52-3f782c394564"; // count/Piece
const ROCKIT_APPLES_ID = "48ee79c1-95d5-431b-bfdf-56ad68c47260"; // count/Tube
const PUSA_ARUNIMA_NAME = "Pusa Arunima Mango";

const RAW_PASTE =
  "Piyush Soni – 9811172811, B-1/156, Paschim Vihar, New Delhi\n" +
  "0.68 kg Red Globe Grapes @ ₹540 = ₹363\n" +
  "0.62 kg Muscat Grapes @ ₹900 = ₹554\n" +
  "1 box Donut Peaches @ ₹550 = ₹550\n" +
  "1 kg Pusa Arunima Mango @ ₹650 = ₹650\n" +
  "1 pc Red Dragon Fruit @ ₹150 = ₹150\n" +
  "1 tube Rockit Apples @ ₹550 = ₹550";

type LineSpec = {
  productId?: string;
  productName: string;
  unitLabel: string;
  qty: number;
  amount: number; // authoritative — user-stated line amount
};

const LINES: LineSpec[] = [
  { productId: RED_GLOBE_GRAPES_ID, productName: "Red Globe Grapes", unitLabel: "kg", qty: 0.68, amount: 363 },
  { productId: MUSCAT_GRAPES_ID, productName: "Muscat Grapes", unitLabel: "kg", qty: 0.62, amount: 554 },
  { productId: DONUT_PEACHES_ID, productName: "Donut Peaches", unitLabel: "Box", qty: 1, amount: 550 },
  { productName: PUSA_ARUNIMA_NAME, unitLabel: "kg", qty: 1, amount: 650 }, // productId filled in after creation
  { productId: RED_DRAGON_FRUIT_ID, productName: "Red Dragon Fruit", unitLabel: "Piece", qty: 1, amount: 150 },
  { productId: ROCKIT_APPLES_ID, productName: "Rockit Apples", unitLabel: "Tube", qty: 1, amount: 550 },
];

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

  const orderTotal = Math.round(LINES.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const netDue = Math.round((prevBalance + orderTotal) * 100) / 100;

  const billLines: BillLineItem[] = LINES.map((l) => ({
    productName: l.productName,
    actualQty: l.qty,
    unitLabel: l.unitLabel,
    ratePerUnit: Math.round((l.amount / l.qty) * 100) / 100,
    amount: l.amount,
  }));
  const messageText = buildBillMessage({
    salutation: "Sir",
    deliveryDate: DELIVERY_DATE,
    lines: billLines,
    total: orderTotal,
    prevBalance,
    netDue,
  });

  console.log("Plan:");
  console.log(`  order: Piyush Soni, delivery_date=${DELIVERY_DATE}, total=₹${orderTotal}`);
  console.log(`  new product needed: "${PUSA_ARUNIMA_NAME}" (weight/kg)`);
  console.log(`  prev_balance=₹${prevBalance.toFixed(2)}  net_due=₹${netDue.toFixed(2)}`);
  console.log(`  ledger: debit ₹${orderTotal}, credit ₹${orderTotal} (other/Razorpay), fully allocated`);
  console.log("\n--- message_text ---\n" + messageText + "\n---------------------\n");

  if (!EXECUTE) {
    console.log("Dry run only — pass --execute to write.");
    return;
  }

  const { data: product, error: productError } = await supabase
    .from("products")
    .insert({ name: PUSA_ARUNIMA_NAME, unit_type: "weight", unit_label: "kg", active: true })
    .select("id")
    .single();
  if (productError) throw new Error(`product insert failed: ${productError.message}`);
  const productIdByName = new Map<string, string>([[PUSA_ARUNIMA_NAME, product.id]]);

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
      notes: "Muscat Grapes billed by weight (0.62 kg) instead of the catalog's default per-box unit for this order, per admin instruction.",
      is_historical: true,
      created_by: null,
    })
    .select("id")
    .single();
  if (orderError) throw new Error(`order insert failed: ${orderError.message}`);

  const lineRows = LINES.map((l) => ({
    order_id: order.id,
    product_id: l.productId ?? productIdByName.get(l.productName)!,
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
    total: orderTotal,
    prev_balance: prevBalance,
    net_due: netDue,
    message_text: messageText,
    finalized_at: nowIso,
  });
  if (billError) throw new Error(`bill insert failed: ${billError.message}`);

  const { error: debitError } = await supabase.from("ledger_entries").insert({
    customer_id: CUSTOMER_ID,
    entry_type: "debit",
    amount: orderTotal,
    order_id: order.id,
  });
  if (debitError) throw new Error(`debit insert failed: ${debitError.message}`);

  const { data: creditRow, error: creditError } = await supabase
    .from("ledger_entries")
    .insert({
      customer_id: CUSTOMER_ID,
      entry_type: "credit",
      amount: orderTotal,
      mode: "other",
      order_id: null,
      note: "Paid via Razorpay payment link — order entered via chat with admin (backfilled 2026-09-14)",
    })
    .select("id")
    .single();
  if (creditError) throw new Error(`credit insert failed: ${creditError.message}`);

  const { error: allocError } = await supabase.from("payment_allocations").insert({
    ledger_entry_id: creditRow.id,
    order_id: order.id,
    amount: orderTotal,
  });
  if (allocError) throw new Error(`allocation insert failed: ${allocError.message}`);

  console.log(`Done. order=${order.id} product=${product.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
