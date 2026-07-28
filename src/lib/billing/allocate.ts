// CLAUDE.md §3.7: "An advance is a credit with no allocation yet; it
// auto-allocates (oldest-unpaid-first) when the next bill finalizes."
// CLAUDE.md §2 explicitly lists ledger allocation as required money-logic
// testing. Pure function: given a customer's advance credits (with
// whatever's already been allocated off each) and a new bill's total,
// decide how much of each advance to apply, oldest first, until the bill
// is covered or the advances run out.

import { roundToCents } from "@/lib/billing/compute";

export interface AdvanceCredit {
  ledgerEntryId: string;
  amount: number;
  allocatedSoFar: number;
  createdAt: Date;
}

export interface AllocationPlanItem {
  ledgerEntryId: string;
  amount: number;
}

export function planAdvanceAllocation(params: {
  advances: AdvanceCredit[];
  billTotal: number;
}): AllocationPlanItem[] {
  const sorted = [...params.advances]
    .filter((advance) => roundToCents(advance.amount - advance.allocatedSoFar) > 0)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const plan: AllocationPlanItem[] = [];
  let remaining = params.billTotal;

  for (const advance of sorted) {
    if (remaining <= 0) break;
    const available = roundToCents(advance.amount - advance.allocatedSoFar);
    const take = Math.min(available, remaining);
    if (take > 0) {
      plan.push({ ledgerEntryId: advance.ledgerEntryId, amount: take });
      remaining = roundToCents(remaining - take);
    }
  }

  return plan;
}
