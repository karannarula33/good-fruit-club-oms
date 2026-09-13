// One-off (and reusable) reset: removes a bill, its debit ledger entry,
// and any credit+allocation created specifically for one order, putting
// it back to a clean "no bill" state. Built to undo two orders that
// correct_overlapping_orders.ts processed incorrectly on its first,
// buggy run (a merge bug meant they got a bill/paid-credit from
// incomplete line data) -- resetting them lets a corrected re-run
// complete them properly via its normal bucket-A path.
//
// Refuses to delete a credit that's allocated to more than one order
// (shared/advance credits aren't this script's business).
//
// Run with: npm run reset-order-billing -- <order-id> [<order-id> ...] [--execute]
// Defaults to a dry run.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";

async function main() {
  const execute = process.argv.includes("--execute");
  const orderIds = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (orderIds.length === 0) {
    console.error("Usage: npm run reset-order-billing -- <order-id> [<order-id> ...] [--execute]");
    process.exit(1);
  }
  console.log(`Mode: ${execute ? "EXECUTE (will write)" : "DRY RUN (no writes)"}\n`);

  const supabase = createServiceRoleClient();

  for (const orderId of orderIds) {
    console.log(`Order ${orderId}:`);
    const { data: bill } = await supabase.from("bills").select("id, total").eq("order_id", orderId).maybeSingle();
    const { data: debit } = await supabase.from("ledger_entries").select("id, amount").eq("order_id", orderId).eq("entry_type", "debit").maybeSingle();
    const { data: allocations } = await supabase.from("payment_allocations").select("id, ledger_entry_id, amount").eq("order_id", orderId);

    console.log(`  bill: ${bill ? `${bill.id} (₹${bill.total})` : "none"}`);
    console.log(`  debit: ${debit ? `${debit.id} (₹${debit.amount})` : "none"}`);
    console.log(`  allocations: ${(allocations ?? []).length}`);

    const creditIdsToCheck = [...new Set((allocations ?? []).map((a) => a.ledger_entry_id))];
    const creditsToDelete: string[] = [];
    for (const creditId of creditIdsToCheck) {
      const { data: allAllocsForCredit } = await supabase.from("payment_allocations").select("order_id").eq("ledger_entry_id", creditId);
      const distinctOrders = new Set((allAllocsForCredit ?? []).map((a) => a.order_id));
      if (distinctOrders.size === 1) {
        creditsToDelete.push(creditId);
        console.log(`  credit ${creditId}: allocated only to this order -- will delete`);
      } else {
        console.log(`  credit ${creditId}: allocated to ${distinctOrders.size} orders -- NOT deleting, leaving as-is`);
      }
    }

    if (!execute) continue;

    if (allocations && allocations.length > 0) {
      const { error } = await supabase.from("payment_allocations").delete().in("id", allocations.map((a) => a.id));
      if (error) throw new Error(`Failed deleting allocations for ${orderId}: ${error.message}`);
    }
    if (creditsToDelete.length > 0) {
      const { error } = await supabase.from("ledger_entries").delete().in("id", creditsToDelete);
      if (error) throw new Error(`Failed deleting credits for ${orderId}: ${error.message}`);
    }
    if (debit) {
      const { error } = await supabase.from("ledger_entries").delete().eq("id", debit.id);
      if (error) throw new Error(`Failed deleting debit for ${orderId}: ${error.message}`);
    }
    if (bill) {
      const { error } = await supabase.from("bills").delete().eq("id", bill.id);
      if (error) throw new Error(`Failed deleting bill for ${orderId}: ${error.message}`);
    }
    console.log(`  reset complete.`);
  }

  if (!execute) console.log("\nDry run only -- no writes made. Re-run with --execute to apply.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
