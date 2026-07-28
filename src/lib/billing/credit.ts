import type { createClient } from "@/lib/supabase/server";
import type { LedgerMode } from "@/lib/supabase/database.types";

export interface InsertCreditParams {
  customerId: string;
  amount: number;
  mode: LedgerMode;
  note: string | null;
  // Empty -- and only empty -- means a pure advance (CLAUDE.md §3.7: "a
  // credit with no allocation yet").
  allocations: { orderId: string; amount: number }[];
  enteredBy: string;
}

export async function insertCredit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: InsertCreditParams,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: creditEntry, error: creditError } = await supabase
    .from("ledger_entries")
    .insert({
      customer_id: params.customerId,
      entry_type: "credit",
      amount: params.amount,
      mode: params.mode,
      order_id: null,
      note: params.note,
      entered_by: params.enteredBy,
    })
    .select("id")
    .single();
  if (creditError || !creditEntry) {
    return { ok: false, error: creditError?.message ?? "Failed to record payment." };
  }

  if (params.allocations.length > 0) {
    const { error: allocError } = await supabase.from("payment_allocations").insert(
      params.allocations.map((allocation) => ({
        ledger_entry_id: creditEntry.id,
        order_id: allocation.orderId,
        amount: allocation.amount,
      })),
    );
    if (allocError) {
      return { ok: false, error: allocError.message };
    }
  }

  return { ok: true };
}
