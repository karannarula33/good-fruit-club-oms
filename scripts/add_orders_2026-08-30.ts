// One-off: add 4 missing Aug 30, 2026 orders, pasted via chat rather than
// the app's Order Entry screen. Verified no order already exists for any
// of these customer+date pairs before writing this.
//
// Run with: npx tsx --env-file=.env.local scripts/add_orders_2026-08-30.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";

const EXECUTE = process.argv.includes("--execute");
const DELIVERY_DATE = "2026-08-30";
const PLACED_AT = "2026-08-30T09:00:00+05:30";

const APPLE_NZ_ID = "d1126da0-8f19-4e8a-9eeb-c81063366113";
const MINI_GUAVA_ID = "2167e144-929b-4cea-86d5-425e3445cb03";
const DONUT_PEACHES_ID = "107485f1-e680-4611-a099-685d8e6e78a0";
const ELAICHI_BANANA_ID = "394cfe1e-05bc-48ea-ba98-0274caeeb307";
const BARTLETT_PEAR_NAME = "Bartlett Pear";

type LineSpec = { productId?: string; productName: string; unitLabel: string; qty: number; amount: number };
type OrderSpec = {
  key: string;
  customerId: string;
  customerName: string;
  salutation: "Sir" | "Ma'am";
  rawPaste: string;
  lines: LineSpec[];
  paidMode: "cash" | "upi" | "other" | null; // null = free/no ledger
  paidNote?: string;
  orderNote?: string | null;
};

const ORDERS: OrderSpec[] = [
  {
    key: "pinki",
    customerId: "6348dcf7-ca3a-46fe-9da6-855cb7b01d8d",
    customerName: "Pinki Mehra",
    salutation: "Ma'am",
    rawPaste:
      "Pinki Mehra – 9811074441, A 18/1, DLF Phase 1\n" +
      "2.000 kg Apple (New Zealand) @ ₹460 = ₹920\n" +
      "1.134 kg Bartlett Pear @ ₹350 = ₹397\n" +
      "1.000 kg Mini Guava @ ₹260 = ₹260",
    lines: [
      { productId: APPLE_NZ_ID, productName: "Apple (New Zealand)", unitLabel: "kg", qty: 2.0, amount: 920 },
      { productName: BARTLETT_PEAR_NAME, unitLabel: "kg", qty: 1.134, amount: 397 }, // productId filled after creation
      { productId: MINI_GUAVA_ID, productName: "Mini Guava", unitLabel: "kg", qty: 1.0, amount: 260 },
    ],
    paidMode: "cash",
    paidNote: "Paid in cash — order entered via chat with admin (backfilled 2026-09-14)",
    orderNote: null,
  },
  {
    key: "swatee",
    customerId: "a8ff8c7f-0362-4767-8828-b0b679466d75",
    customerName: "Swatee",
    salutation: "Ma'am",
    rawPaste:
      "Swatee – 9810361333, DLF Park Place Towers, Tower L, Flat 274, DLF Phase 5, Gurgaon 122011\n" +
      "1.000 kg Apple (New Zealand) @ ₹460 = ₹460\n" +
      "1/2 box Donut Peaches @ ₹550/box = ₹275",
    lines: [
      { productId: APPLE_NZ_ID, productName: "Apple (New Zealand)", unitLabel: "kg", qty: 1.0, amount: 460 },
      { productId: DONUT_PEACHES_ID, productName: "Donut Peaches", unitLabel: "box", qty: 0.5, amount: 275 },
    ],
    paidMode: "upi",
    paidNote: "Paid via UPI — order entered via chat with admin (backfilled 2026-09-14)",
    orderNote: null,
  },
  {
    key: "rita",
    customerId: "44f68e0d-7b16-4013-a63b-cd0a53331702",
    customerName: "Rita Parkash",
    salutation: "Ma'am",
    rawPaste:
      "Rita Prakash – 9810258886, K 7/18, DLF Phase 2, Gurgaon\n" +
      "1 box Donut Peaches @ ₹550 = ₹550",
    lines: [{ productId: DONUT_PEACHES_ID, productName: "Donut Peaches", unitLabel: "box", qty: 1, amount: 550 }],
    paidMode: "upi",
    paidNote: "Paid via UPI — order entered via chat with admin (backfilled 2026-09-14)",
    orderNote: "Matched to existing customer 'Rita Parkash' — sheet/chat spelling 'Rita Prakash' treated as the same person (name variant).",
  },
  {
    key: "suroor",
    customerId: "01db9774-466e-4af4-8d2f-c1e7bc12e358",
    customerName: "Suroor",
    salutation: "Ma'am",
    rawPaste: "Suroor – 9899222001, A 158 Sushant Lok 1 gurgaon\n1kg Elaichi Bananas (free replacement for previous order)",
    lines: [{ productId: ELAICHI_BANANA_ID, productName: "Yellaki (Elaichi) Banana", unitLabel: "kg", qty: 1, amount: 0 }],
    paidMode: null,
    orderNote: "Free replacement for a previous Elaichi Banana order. Billed at ₹0. Billed by weight (1 kg) rather than the catalog's default per-piece unit for this order.",
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

  let bartlettPearId: string | null = null;
  if (EXECUTE) {
    const { data: product, error } = await supabase
      .from("products")
      .insert({ name: BARTLETT_PEAR_NAME, unit_type: "weight", unit_label: "kg", active: true })
      .select("id")
      .single();
    if (error) throw new Error(`Bartlett Pear product insert failed: ${error.message}`);
    bartlettPearId = product.id;
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
      ratePerUnit: l.amount === 0 ? 0 : Math.round((l.amount / l.qty) * 100) / 100,
      amount: l.amount,
    }));
    const messageText = buildBillMessage({
      salutation: o.salutation,
      deliveryDate: DELIVERY_DATE,
      lines: billLines,
      total,
      prevBalance,
      netDue: o.paidMode === null ? prevBalance : netDue,
    });

    console.log(`=== ${o.customerName} ===`);
    console.log(`  total=₹${total}  prev_balance=₹${prevBalance.toFixed(2)}  net_due=₹${(o.paidMode === null ? prevBalance : netDue).toFixed(2)}`);
    console.log(`  payment: ${o.paidMode ?? "none (₹0, no ledger entries)"}`);
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
        notes: o.orderNote ?? null,
        is_historical: true,
        created_by: null,
      })
      .select("id")
      .single();
    if (orderError) throw new Error(`${o.customerName}: order insert failed: ${orderError.message}`);

    const lineRows = o.lines.map((l) => ({
      order_id: order.id,
      product_id: l.productId ?? bartlettPearId!,
      ordered_qty: l.qty,
      ordered_unit: l.unitLabel,
      locked_price_per_unit: l.amount === 0 ? 0 : Math.round((l.amount / l.qty) * 100) / 100,
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
      net_due: o.paidMode === null ? prevBalance : netDue,
      message_text: messageText,
      finalized_at: new Date().toISOString(),
    });
    if (billError) throw new Error(`${o.customerName}: bill insert failed: ${billError.message}`);

    if (o.paidMode !== null) {
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
    }

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
