"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { roundToCents } from "@/lib/billing/compute";
import type { LedgerMode } from "@/lib/supabase/database.types";

export interface RecordPaymentInput {
  customerId: string;
  amount: number;
  mode: LedgerMode;
  note: string | null;
  // Leave empty to record a pure advance (CLAUDE.md §3.7: "a credit with
  // no allocation yet"). Any amount left unallocated (payment amount minus
  // the sum of these) simply stays unallocated -- it becomes/stays an
  // advance, auto-allocated the next time a bill finalizes.
  allocations: { orderId: string; amount: number }[];
}

export async function recordPayment(
  input: RecordPaymentInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await requireRole(["admin"]);

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: "Amount must be greater than zero." };
  }
  for (const allocation of input.allocations) {
    if (!Number.isFinite(allocation.amount) || allocation.amount <= 0) {
      return { ok: false, error: "Every allocation amount must be greater than zero." };
    }
  }
  const allocatedTotal = roundToCents(input.allocations.reduce((sum, a) => sum + a.amount, 0));
  if (allocatedTotal > roundToCents(input.amount)) {
    return { ok: false, error: "Allocated amount can't exceed the payment amount." };
  }

  const supabase = await createClient();

  const { data: creditEntry, error: creditError } = await supabase
    .from("ledger_entries")
    .insert({
      customer_id: input.customerId,
      entry_type: "credit",
      amount: input.amount,
      mode: input.mode,
      order_id: null,
      note: input.note,
      entered_by: profile.id,
    })
    .select("id")
    .single();
  if (creditError || !creditEntry) {
    return { ok: false, error: creditError?.message ?? "Failed to record payment." };
  }

  if (input.allocations.length > 0) {
    const { error: allocError } = await supabase.from("payment_allocations").insert(
      input.allocations.map((allocation) => ({
        ledger_entry_id: creditEntry.id,
        order_id: allocation.orderId,
        amount: allocation.amount,
      })),
    );
    if (allocError) {
      return { ok: false, error: allocError.message };
    }
  }

  revalidatePath(`/admin/customers/${input.customerId}`);
  return { ok: true };
}
