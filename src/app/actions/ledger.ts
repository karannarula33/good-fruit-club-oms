"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { roundToCents } from "@/lib/billing/compute";
import { insertCredit } from "@/lib/billing/credit";
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

  const result = await insertCredit(supabase, {
    customerId: input.customerId,
    amount: input.amount,
    mode: input.mode,
    note: input.note,
    allocations: input.allocations,
    enteredBy: profile.id,
  });
  if (!result.ok) {
    return result;
  }

  revalidatePath(`/admin/customers/${input.customerId}`);
  return { ok: true };
}
