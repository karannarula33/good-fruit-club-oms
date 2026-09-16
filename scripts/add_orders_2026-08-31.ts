// One-off: add 7 missing Aug 31, 2026 orders, pasted via chat rather than
// the app's Order Entry screen. Verified no order already exists for any
// of these customer+date pairs before writing this. Nina Sagar's order
// (8th) is held back — message was cut off mid-line (no rate for Red
// Globe Grapes, no order total, and she's not an existing customer).
//
// None of the multi-line orders included an explicit total, so each
// order's total is the sum of the stated per-line amounts. Several lines'
// qty*rate doesn't exactly match the stated amount (small rounding) — the
// stated amount is treated as authoritative and the rate is backed out.
//
// Run with: npx tsx --env-file=.env.local scripts/add_orders_2026-08-31.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";

const EXECUTE = process.argv.includes("--execute");
const DELIVERY_DATE = "2026-08-31";
const PLACED_AT = "2026-08-31T09:00:00+05:30";

const DONUT_PEACHES_ID = "107485f1-e680-4611-a099-685d8e6e78a0";
const PAPAYA_ID = "a24e99f2-1dd0-471e-a8be-42bf0a08fc12";
const BLACK_AMBER_PLUM_ID = "f18e8b51-c603-4b62-b4a7-a9f5d407b627";
const MANDARIN_ORANGE_ID = "69dc3cc5-b151-4c46-919e-853bca967059";
const POMEGRANATE_ID = "262e7251-9daf-44d9-9bfa-c8650e7f4a07"; // "Anaar" alias already maps here
const RED_BANANA_ID = "a6d0babe-956b-4f31-ac27-b81602521f7f";
const APPLE_NZ_ID = "d1126da0-8f19-4e8a-9eeb-c81063366113";
const SUN_MELON_ID = "7491e64b-bf14-444f-8cb8-a1eb364eb5f8";
const RED_DRAGON_FRUIT_ID = "b92b6d90-81be-4608-ab52-3f782c394564";

const PREMIUM_MAUSMI_NAME = "Premium Mausmi";
const MOON_DROPS_GRAPES_NAME = "Moon Drops Grapes";
const RANI_PINEAPPLE_NAME = "Rani Pineapple";

type LineSpec = { productId?: string; newProductKey?: string; productName: string; unitLabel: string; qty: number; amount: number };
type OrderSpec = {
  key: string;
  customerId: string;
  customerName: string;
  salutation: "Sir" | "Ma'am";
  rawPaste: string;
  lines: LineSpec[];
  paidMode: "cash" | "upi" | "other";
  paidNote: string;
};

const NEW_PRODUCTS: { key: string; name: string; unitLabel: string }[] = [
  { key: "mausmi", name: PREMIUM_MAUSMI_NAME, unitLabel: "kg" },
  { key: "moondrops", name: MOON_DROPS_GRAPES_NAME, unitLabel: "kg" },
  { key: "ranipineapple", name: RANI_PINEAPPLE_NAME, unitLabel: "piece" },
];

const ORDERS: OrderSpec[] = [
  {
    key: "punam",
    customerId: "bf867113-b15a-405f-9e83-b9564601f573",
    customerName: "Punam Kumar",
    salutation: "Ma'am",
    rawPaste: "Punam Kumar – 98110 48122, M 3/1 DLF Phase 2 Gurgaon\n1.400 kg Papaya @ ₹150 = ₹210",
    lines: [{ productId: PAPAYA_ID, productName: "Papaya", unitLabel: "kg", qty: 1.4, amount: 210 }],
    paidMode: "upi",
    paidNote: "Paid via UPI — order entered via chat with admin (backfilled 2026-09-14)",
  },
  {
    key: "suroor",
    customerId: "01db9774-466e-4af4-8d2f-c1e7bc12e358",
    customerName: "Suroor",
    salutation: "Ma'am",
    rawPaste: "Suroor – 9899222001, A 158 Sushant Lok 1 gurgaon\n2 boxes Donut Peaches @ ₹550 = ₹1,100",
    lines: [{ productId: DONUT_PEACHES_ID, productName: "Donut Peaches", unitLabel: "box", qty: 2, amount: 1100 }],
    paidMode: "cash",
    paidNote: "Paid in cash — order entered via chat with admin (backfilled 2026-09-14)",
  },
  {
    key: "arjun",
    customerId: "6db508e2-dc55-4fbc-a98e-9dafac4cb36a",
    customerName: "Arjun Chopra",
    salutation: "Sir",
    rawPaste:
      "Arjun Chopra – 9811050885, C-84, The Summit, Park Drive, DLF Phase 5, Sec 54, Gurgaon\n" +
      "1 box Donut Peaches @ ₹550 = ₹550\n" +
      "1.08 kg Black Amber Plum @ ₹350 = ₹377\n" +
      "2.1 kg Premium Mausmi @ ₹150 = ₹315\n" +
      "0.542 kg Moon Drops Grapes @ ₹700 = ₹379\n" +
      "1.05 kg Mandarin Orange @ ₹420 = ₹440",
    lines: [
      { productId: DONUT_PEACHES_ID, productName: "Donut Peaches", unitLabel: "box", qty: 1, amount: 550 },
      { productId: BLACK_AMBER_PLUM_ID, productName: "Black Amber Plum", unitLabel: "kg", qty: 1.08, amount: 377 },
      { newProductKey: "mausmi", productName: PREMIUM_MAUSMI_NAME, unitLabel: "kg", qty: 2.1, amount: 315 },
      { newProductKey: "moondrops", productName: MOON_DROPS_GRAPES_NAME, unitLabel: "kg", qty: 0.542, amount: 379 },
      { productId: MANDARIN_ORANGE_ID, productName: "Mandarin Orange", unitLabel: "kg", qty: 1.05, amount: 440 },
    ],
    paidMode: "cash",
    paidNote: "Paid in cash — order entered via chat with admin (backfilled 2026-09-14)",
  },
  {
    key: "simran",
    customerId: "4d2fa6a2-d406-4f17-87d5-7704b60cc513",
    customerName: "Simran Kumar",
    salutation: "Ma'am",
    rawPaste: "Simran Kumar – 9810561415, M-11/5 A, 2nd Floor, DLF Phase 2\n1 box Donut Peaches @ ₹550 = ₹550",
    lines: [{ productId: DONUT_PEACHES_ID, productName: "Donut Peaches", unitLabel: "box", qty: 1, amount: 550 }],
    paidMode: "upi",
    paidNote: "Paid via UPI — order entered via chat with admin (backfilled 2026-09-14)",
  },
  {
    key: "shyamrao",
    customerId: "5f785ac4-7adf-47a2-90ce-a31278c44a68",
    customerName: "Shyamrao Nayak",
    salutation: "Sir",
    rawPaste:
      "Shyamrao Nayak – 9958903999, N-14/29 B, GF, DLF City phase-2\n" +
      "1.1 kg Anaar @ ₹380 = ₹418\n" +
      "1.08 kg Red Banana @ ₹280 = ₹302\n" +
      "1 pc Rani Pineapple @ ₹240 = ₹240",
    lines: [
      { productId: POMEGRANATE_ID, productName: "Pomegranate (Anaar)", unitLabel: "kg", qty: 1.1, amount: 418 },
      { productId: RED_BANANA_ID, productName: "Red Banana", unitLabel: "kg", qty: 1.08, amount: 302 },
      { newProductKey: "ranipineapple", productName: RANI_PINEAPPLE_NAME, unitLabel: "piece", qty: 1, amount: 240 },
    ],
    paidMode: "cash",
    paidNote: "Paid in cash — order entered via chat with admin (backfilled 2026-09-14)",
  },
  {
    key: "sunil",
    customerId: "a3f2ba56-1449-4790-8e0a-d2434ef93c81",
    customerName: "Sunil Malhotra",
    salutation: "Sir",
    rawPaste:
      "Sunil Malhotra – 9811012890, K-13/20, DLF Phase 2\n" +
      "2.08 kg Mandarin Orange @ ₹420 = ₹872\n" +
      "2 kg Apple (New Zealand) @ ₹460 = ₹920\n" +
      "2.13 kg Sun Melon @ ₹190 = ₹404\n" +
      "2.48 kg Papaya @ ₹150 = ₹371\n" +
      "1 pc Red Dragon Fruit @ ₹150 = ₹150\n" +
      "0.6 kg Anaar @ ₹380 = ₹233",
    lines: [
      { productId: MANDARIN_ORANGE_ID, productName: "Mandarin Orange", unitLabel: "kg", qty: 2.08, amount: 872 },
      { productId: APPLE_NZ_ID, productName: "Apple (New Zealand)", unitLabel: "kg", qty: 2, amount: 920 },
      { productId: SUN_MELON_ID, productName: "Sun Melon", unitLabel: "kg", qty: 2.13, amount: 404 },
      { productId: PAPAYA_ID, productName: "Papaya", unitLabel: "kg", qty: 2.48, amount: 371 },
      { productId: RED_DRAGON_FRUIT_ID, productName: "Red Dragon Fruit", unitLabel: "pc", qty: 1, amount: 150 },
      { productId: POMEGRANATE_ID, productName: "Pomegranate (Anaar)", unitLabel: "kg", qty: 0.6, amount: 233 },
    ],
    paidMode: "upi",
    paidNote: "Paid via UPI — order entered via chat with admin (backfilled 2026-09-14)",
  },
  {
    key: "raseel",
    customerId: "732fd09b-2ba3-4cce-bf58-e90b9415d2a7",
    customerName: "Raseel Arun Kant",
    salutation: "Sir",
    rawPaste:
      "Raseel Arun Kant – G11/13, DLF Phase 1\n" +
      "1.4 kg Papaya @ ₹150 = ₹210\n" +
      "1 box Donut Peaches @ ₹550 = ₹550",
    lines: [
      { productId: PAPAYA_ID, productName: "Papaya", unitLabel: "kg", qty: 1.4, amount: 210 },
      { productId: DONUT_PEACHES_ID, productName: "Donut Peaches", unitLabel: "box", qty: 1, amount: 550 },
    ],
    paidMode: "cash",
    paidNote: "Paid in cash — order entered via chat with admin (backfilled 2026-09-14)",
  },
];

async function main() {
  const supabase = createServiceRoleClient();

  for (const o of ORDERS) {
    const { data: existing } = await supabase
      .from("orders")
      .select("id")
      .eq("customer_id", o.customerId)
      .eq("delivery_date", DELIVERY_DATE);
    if (existing && existing.length > 0) {
      throw new Error(`${o.customerName}: order already exists for ${DELIVERY_DATE}: ${existing.map((x) => x.id).join(", ")}`);
    }
  }

  const newProductIds = new Map<string, string>();
  if (EXECUTE) {
    for (const np of NEW_PRODUCTS) {
      const { data: product, error } = await supabase
        .from("products")
        .insert({ name: np.name, unit_type: "weight", unit_label: np.unitLabel, active: true })
        .select("id")
        .single();
      if (error) throw new Error(`${np.name} product insert failed: ${error.message}`);
      newProductIds.set(np.key, product.id);
    }
  }

  for (const o of ORDERS) {
    const { data: ledger } = await supabase
      .from("ledger_entries")
      .select("entry_type, amount")
      .eq("customer_id", o.customerId);
    const prevBalance = Math.round(
      (ledger ?? []).reduce((sum, e) => sum + (e.entry_type === "debit" ? e.amount : -e.amount), 0) * 100,
    ) / 100;

    const total = Math.round(o.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const netDue = Math.round((prevBalance + total) * 100) / 100;

    const billLines: BillLineItem[] = o.lines.map((l) => ({
      productName: l.productName,
      actualQty: l.qty,
      unitLabel: l.unitLabel,
      ratePerUnit: Math.round((l.amount / l.qty) * 100) / 100,
      amount: l.amount,
    }));
    const messageText = buildBillMessage({
      salutation: o.salutation,
      deliveryDate: DELIVERY_DATE,
      lines: billLines,
      total,
      prevBalance,
      netDue,
    });

    console.log(`=== ${o.customerName} ===`);
    console.log(`  total=₹${total}  prev_balance=₹${prevBalance.toFixed(2)}  net_due=₹${netDue.toFixed(2)}  payment=${o.paidMode}`);
    console.log(`\n--- message_text ---\n${messageText}\n---------------------\n`);

    if (!EXECUTE) continue;

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        customer_id: o.customerId,
        placed_at: PLACED_AT,
        delivery_date: DELIVERY_DATE,
        status: "delivered",
        status_timestamps: { delivered: PLACED_AT },
        raw_paste: o.rawPaste,
        notes: null,
        is_historical: true,
        created_by: null,
      })
      .select("id")
      .single();
    if (orderError) throw new Error(`${o.customerName}: order insert failed: ${orderError.message}`);

    const lineRows = o.lines.map((l) => ({
      order_id: order.id,
      product_id: l.productId ?? newProductIds.get(l.newProductKey!)!,
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
    if (linesError) throw new Error(`${o.customerName}: order_lines insert failed: ${linesError.message}`);

    const { error: billError } = await supabase.from("bills").insert({
      order_id: order.id,
      total,
      prev_balance: prevBalance,
      net_due: netDue,
      message_text: messageText,
      finalized_at: new Date().toISOString(),
    });
    if (billError) throw new Error(`${o.customerName}: bill insert failed: ${billError.message}`);

    const { error: debitError } = await supabase.from("ledger_entries").insert({
      customer_id: o.customerId,
      entry_type: "debit",
      amount: total,
      order_id: order.id,
    });
    if (debitError) throw new Error(`${o.customerName}: debit insert failed: ${debitError.message}`);

    const { data: creditRow, error: creditError } = await supabase
      .from("ledger_entries")
      .insert({
        customer_id: o.customerId,
        entry_type: "credit",
        amount: total,
        mode: o.paidMode,
        order_id: null,
        note: o.paidNote,
      })
      .select("id")
      .single();
    if (creditError) throw new Error(`${o.customerName}: credit insert failed: ${creditError.message}`);

    const { error: allocError } = await supabase.from("payment_allocations").insert({
      ledger_entry_id: creditRow.id,
      order_id: order.id,
      amount: total,
    });
    if (allocError) throw new Error(`${o.customerName}: allocation insert failed: ${allocError.message}`);

    console.log(`${o.customerName}: done. order=${order.id}`);
  }

  if (!EXECUTE) {
    console.log("Dry run only — pass --execute to write.");
    return;
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
