// Rashmi Wadhwa's Sep 8, 2026 order was already billed (₹550, unpaid) but
// should have been cancelled per admin. Removes the bill + ledger debit
// and marks the order cancelled (status_timestamps replaced with just
// {cancelled: ...}, matching every other cancelled order in the DB).
//
// Run with: npx tsx --env-file=.env.local scripts/cancel_sep8_rashmi_wadhwa.ts [--execute]
// Defaults to a dry run unless --execute is passed.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";

const EXECUTE = process.argv.includes("--execute");

const ORDER_ID = "f23c7cdf-f2d2-4630-9282-bd9467787e29";
const BILL_ID = "6a6e6d2e-9813-4bf4-a69a-ab4558113cea";
const DEBIT_ID = "7e54064e-9e9a-49fb-84fd-005c2ef9a3b8";

async function main() {
  const supabase = createServiceRoleClient();

  console.log("Plan:");
  console.log(`  delete bill ${BILL_ID} (₹550) and debit ${DEBIT_ID} (₹550)`);
  console.log(`  set order ${ORDER_ID} status -> cancelled`);

  if (!EXECUTE) {
    console.log("Dry run only — pass --execute to write.");
    return;
  }

  const { error: billDelError } = await supabase.from("bills").delete().eq("id", BILL_ID);
  if (billDelError) throw new Error(`bill delete failed: ${billDelError.message}`);

  const { error: debitDelError } = await supabase.from("ledger_entries").delete().eq("id", DEBIT_ID);
  if (debitDelError) throw new Error(`debit delete failed: ${debitDelError.message}`);

  const { error: orderError } = await supabase
    .from("orders")
    .update({ status: "cancelled", status_timestamps: { cancelled: new Date().toISOString() } })
    .eq("id", ORDER_ID);
  if (orderError) throw new Error(`order update failed: ${orderError.message}`);

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
