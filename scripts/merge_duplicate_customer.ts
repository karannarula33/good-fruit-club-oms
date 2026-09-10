// One-off (and reusable) customer-record merge: reassigns every FK
// reference from a duplicate customer id onto the real one, then deletes
// the duplicate. Built for the "Archana Kakkar" / "Archana Kakar" pair
// found during the 2026-09 historical import (same phone, one typo'd) --
// kept generic since the sheet's dedup review found ~10 phone numbers
// with name-spelling variants, some of which may turn out to be the same
// pattern. Every FK to public.customers per the migrations (0005, 0008,
// 0013) is handled: orders, ledger_entries, eng_nudge_queue,
// eng_suppression get reassigned; eng_customer_state gets dropped for the
// removed id (it's "recomputed each nightly run, no manual entry" per
// 0013's own comment, so this is expected upkeep, not data loss).
//
// Run with: npm run merge-duplicate-customer -- <keep-id> <remove-id> [--execute]
// Defaults to a dry run.

import { createServiceRoleClient } from "../src/lib/supabase/service-role";

async function main() {
  const execute = process.argv.includes("--execute");
  const [keepId, removeId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!keepId || !removeId) {
    console.error("Usage: npm run merge-duplicate-customer -- <keep-id> <remove-id> [--execute]");
    process.exit(1);
  }

  console.log(`Mode: ${execute ? "EXECUTE (will write)" : "DRY RUN (no writes)"}`);

  const supabase = createServiceRoleClient();

  const [{ data: keep, error: keepError }, { data: remove, error: removeError }] = await Promise.all([
    supabase.from("customers").select("id, display_name, phone, address").eq("id", keepId).single(),
    supabase.from("customers").select("id, display_name, phone, address").eq("id", removeId).single(),
  ]);
  if (keepError || !keep) throw new Error(`Keep-id not found: ${keepError?.message}`);
  if (removeError || !remove) throw new Error(`Remove-id not found: ${removeError?.message}`);

  console.log(`Keep:   ${keep.display_name} (${keep.phone}) -- ${keep.id}`);
  console.log(`Remove: ${remove.display_name} (${remove.phone}) -- ${remove.id}`);

  const [{ data: orders }, { data: ledgerEntries }, { data: engState }, { data: engQueue }, { data: engSuppression }] =
    await Promise.all([
      supabase.from("orders").select("id, is_historical, placed_at").eq("customer_id", removeId),
      supabase.from("ledger_entries").select("id").eq("customer_id", removeId),
      supabase.from("eng_customer_state").select("customer_id").eq("customer_id", removeId),
      supabase.from("eng_nudge_queue").select("id").eq("customer_id", removeId),
      supabase.from("eng_suppression").select("customer_id, reason").eq("customer_id", removeId),
    ]);

  console.log(`\nWill reassign to ${keep.display_name}:`);
  console.log(`  orders: ${orders?.length ?? 0}`);
  console.log(`  ledger_entries: ${ledgerEntries?.length ?? 0}`);
  console.log(`  eng_nudge_queue: ${engQueue?.length ?? 0}`);
  console.log(`  eng_suppression rows: ${engSuppression?.length ?? 0}`);
  console.log(`Will drop (derived/recomputed, not manually entered): eng_customer_state rows: ${engState?.length ?? 0}`);

  if (!execute) {
    console.log("\nDry run only -- no writes made. Re-run with --execute to apply.");
    return;
  }

  if (orders && orders.length > 0) {
    const { error } = await supabase.from("orders").update({ customer_id: keepId }).eq("customer_id", removeId);
    if (error) throw new Error(`Failed reassigning orders: ${error.message}`);
  }
  if (ledgerEntries && ledgerEntries.length > 0) {
    const { error } = await supabase.from("ledger_entries").update({ customer_id: keepId }).eq("customer_id", removeId);
    if (error) throw new Error(`Failed reassigning ledger_entries: ${error.message}`);
  }
  if (engQueue && engQueue.length > 0) {
    const { error } = await supabase.from("eng_nudge_queue").update({ customer_id: keepId }).eq("customer_id", removeId);
    if (error) throw new Error(`Failed reassigning eng_nudge_queue: ${error.message}`);
  }
  if (engSuppression && engSuppression.length > 0) {
    const { error } = await supabase.from("eng_suppression").update({ customer_id: keepId }).eq("customer_id", removeId);
    if (error) throw new Error(`Failed reassigning eng_suppression: ${error.message}`);
  }
  if (engState && engState.length > 0) {
    const { error } = await supabase.from("eng_customer_state").delete().eq("customer_id", removeId);
    if (error) throw new Error(`Failed dropping eng_customer_state: ${error.message}`);
  }

  const { error: deleteError } = await supabase.from("customers").delete().eq("id", removeId);
  if (deleteError) throw new Error(`Failed deleting duplicate customer: ${deleteError.message}`);

  console.log(`\nMerged. "${remove.display_name}" (${removeId}) removed; all references now point to "${keep.display_name}" (${keepId}).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
