// Swatee's Sep 1, 2026 order actually got delivered together with her
// Sep 2 order (admin instruction) and was paid online as one combined
// ₹2067. Merges the Sep 1 order's 4 lines into the existing Sep 2 order
// (append, per CLAUDE.md §3.9's same-customer-same-date merge rule),
// deletes the now-empty Sep 1 order (bill + ledger debit + the order row
// itself), and posts one paid-online credit for the combined total.
//
// Both orders' ledger debits are plain (unpaid, no matching credit) —
// safe to delete/replace in place.
//
// Run with: npx tsx --env-file=.env.local scripts/merge_swatee_sep1_into_sep2.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { buildBillMessage, type BillLineItem } from "../src/lib/billing/message";

const EXECUTE = process.argv.includes("--execute");

const CUSTOMER_ID = "a8ff8c7f-0362-4767-8828-b0b679466d75"; // Swatee
const SEP1_ORDER_ID = "704fb044-8921-4c5a-a198-bbf88256f94a";
const SEP1_BILL_ID = "a59fc050-79af-4bb2-8ae7-c840515538fc";
const SEP1_DEBIT_ID = "e0a14637-14a8-45c6-bb34-4048defa410c";
const SEP1_PACKAGE_ID = "7212cb15-cdf1-4c43-bdef-d0dffeb8efc3";
const SEP1_LINE_IDS = [
  "c0bfc416-49e0-44ad-9ab3-a0f2d469887c",
  "753f7596-e48b-48ec-92e9-1a015ce1e82b",
  "77cb8e76-2abb-418d-ae0d-6b4be86547ff",
  "e33ded1c-506c-4b94-977a-c8d69e44d917",
];

const SEP2_ORDER_ID = "c6663aeb-d29f-47da-b140-5465e20dac6f";
const SEP2_BILL_ID = "e7bbf1e8-c8df-4542-aa38-f7eb8382a2f5";
const SEP2_DEBIT_ID = "ba1ebb9d-44ce-49c1-b136-f7b40ed73718";

const COMBINED_TOTAL = 2067; // admin-stated actual total (line sum is 2066; treated as rounding)

const SEP1_RAW_PASTE_APPEND =
  "\n\n[Merged from Sep 1 order 2026-09-14 — delivered together with Sep 2, paid online as one ₹2067 total]\n" +
  "Swatee\nNormal Box\n1) 1 kg aanar\n2) 1 kg apple\n3) 1 box peaches \n4) 1 box blueberries";

async function main() {
  const supabase = createServiceRoleClient();

  const { data: ledger } = await supabase
    .from("ledger_entries")
    .select("entry_type, amount, id")
    .eq("customer_id", CUSTOMER_ID);
  const currentBalance = Math.round(
    (ledger ?? []).reduce((sum, e) => sum + (e.entry_type === "debit" ? e.amount : -e.amount), 0) * 100,
  ) / 100;
  // Balance before both the Sep1 (1796) and Sep2 (270) debits being replaced.
  const prevBalance = Math.round((currentBalance - 1796 - 270) * 100) / 100;
  const netDue = Math.round((prevBalance + COMBINED_TOTAL) * 100) / 100;

  const combinedLines: BillLineItem[] = [
    { productName: "Donut Peaches – 1 box", actualQty: 1, unitLabel: "Box", ratePerUnit: 550, amount: 550 },
    { productName: "Jumbo Blueberry", actualQty: 1, unitLabel: "Box", ratePerUnit: 330, amount: 330 },
    { productName: "Pomegranate", actualQty: 1.2, unitLabel: "kg", ratePerUnit: 380, amount: 456 },
    { productName: "Apple (New Zealand)", actualQty: 1, unitLabel: "kg", ratePerUnit: 460, amount: 460 },
    { productName: "Yellaki (Elaichi) Banana", actualQty: 0.226, unitLabel: "piece", ratePerUnit: 300, amount: 68 },
    { productName: "Papaya", actualQty: 1.344, unitLabel: "pc", ratePerUnit: 150, amount: 202 },
  ];
  const messageText = buildBillMessage({
    salutation: "Ma'am",
    deliveryDate: "2026-09-02",
    lines: combinedLines,
    total: COMBINED_TOTAL,
    prevBalance,
    netDue,
  });

  console.log("Plan:");
  console.log(`  merge Sep1 order (${SEP1_ORDER_ID}) into Sep2 order (${SEP2_ORDER_ID})`);
  console.log(`  delete Sep1 bill/debit/order; re-parent 4 lines + 1 order_packages row`);
  console.log(`  combined total=₹${COMBINED_TOTAL}  prev_balance=₹${prevBalance}  net_due=₹${netDue}`);
  console.log(`  new paid-online credit: ₹${COMBINED_TOTAL}`);
  console.log(`\n--- message_text ---\n${messageText}\n---------------------\n`);

  if (!EXECUTE) {
    console.log("Dry run only — pass --execute to write.");
    return;
  }

  // Re-parent order_packages row.
  const { error: pkgError } = await supabase
    .from("order_packages")
    .update({ order_id: SEP2_ORDER_ID })
    .eq("id", SEP1_PACKAGE_ID);
  if (pkgError) throw new Error(`order_packages re-parent failed: ${pkgError.message}`);

  // Re-parent order_lines.
  const { error: linesError } = await supabase
    .from("order_lines")
    .update({ order_id: SEP2_ORDER_ID })
    .in("id", SEP1_LINE_IDS);
  if (linesError) throw new Error(`order_lines re-parent failed: ${linesError.message}`);

  // Append Sep1's raw_paste onto Sep2's order for audit trail.
  const { data: sep2Order, error: sep2FetchError } = await supabase
    .from("orders")
    .select("raw_paste")
    .eq("id", SEP2_ORDER_ID)
    .single();
  if (sep2FetchError) throw new Error(`sep2 order fetch failed: ${sep2FetchError.message}`);
  const { error: sep2RawPasteError } = await supabase
    .from("orders")
    .update({ raw_paste: (sep2Order.raw_paste ?? "") + SEP1_RAW_PASTE_APPEND })
    .eq("id", SEP2_ORDER_ID);
  if (sep2RawPasteError) throw new Error(`sep2 raw_paste update failed: ${sep2RawPasteError.message}`);

  // Delete Sep1's bill, debit, and the now-empty order row.
  const { error: sep1BillDelError } = await supabase.from("bills").delete().eq("id", SEP1_BILL_ID);
  if (sep1BillDelError) throw new Error(`sep1 bill delete failed: ${sep1BillDelError.message}`);

  const { error: sep1DebitDelError } = await supabase.from("ledger_entries").delete().eq("id", SEP1_DEBIT_ID);
  if (sep1DebitDelError) throw new Error(`sep1 debit delete failed: ${sep1DebitDelError.message}`);

  const { error: sep1OrderDelError } = await supabase.from("orders").delete().eq("id", SEP1_ORDER_ID);
  if (sep1OrderDelError) throw new Error(`sep1 order delete failed: ${sep1OrderDelError.message}`);

  // Update Sep2's bill to the combined total.
  const { error: sep2BillError } = await supabase
    .from("bills")
    .update({ total: COMBINED_TOTAL, prev_balance: prevBalance, net_due: netDue, message_text: messageText })
    .eq("id", SEP2_BILL_ID);
  if (sep2BillError) throw new Error(`sep2 bill update failed: ${sep2BillError.message}`);

  // Update Sep2's debit to the combined total.
  const { error: sep2DebitError } = await supabase
    .from("ledger_entries")
    .update({ amount: COMBINED_TOTAL })
    .eq("id", SEP2_DEBIT_ID);
  if (sep2DebitError) throw new Error(`sep2 debit update failed: ${sep2DebitError.message}`);

  // Post the paid-online credit for the combined total.
  const { data: creditRow, error: creditError } = await supabase
    .from("ledger_entries")
    .insert({
      customer_id: CUSTOMER_ID,
      entry_type: "credit",
      amount: COMBINED_TOTAL,
      mode: "other",
      order_id: null,
      note: "Paid online — Sep 1 order merged into Sep 2 delivery (backfilled 2026-09-14)",
    })
    .select("id")
    .single();
  if (creditError) throw new Error(`credit insert failed: ${creditError.message}`);

  const { error: allocError } = await supabase.from("payment_allocations").insert({
    ledger_entry_id: creditRow.id,
    order_id: SEP2_ORDER_ID,
    amount: COMBINED_TOTAL,
  });
  if (allocError) throw new Error(`allocation insert failed: ${allocError.message}`);

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
