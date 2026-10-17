// Editing a bill after it was generated (admin, 2026-10-17: "edit even
// generated bills in case of any discrepancy"). The admin corrects a line's
// qty or rate, removes a line or adds one on the Manage Orders screen, and
// the bill is rebuilt in place (src/app/actions/bill-edit.ts). Pure rules
// here; tested in tests/billing/edit.test.ts.
//
//   * Edited lines bill at the rate on the line -- an edit never re-resolves
//     prices from the price list.
//   * "Previous balance" on the rebuilt bill is everything else on the
//     customer's account: the whole ledger except this order's own debit --
//     exactly what it was when the bill was first generated (the debit didn't
//     exist yet), updated for anything paid or billed since.
//   * If the new total is below what has already been allocated to the order,
//     the newest allocations are trimmed until they fit; the money freed stays
//     on the account as an advance. Nothing paid is ever lost.

import { computeCustomerBalance, roundToCents } from "./compute";

export interface AllocationRow {
  id: string;
  amount: number;
  createdAt: string; // of the allocation's credit; newest is trimmed first
}

// Returns only the allocations that change, with their new amount
// (0 = remove the allocation).
export function planAllocationTrim(rows: AllocationRow[], newTotal: number): { id: string; amount: number }[] {
  let excess = roundToCents(rows.reduce((sum, r) => sum + r.amount, 0) - Math.max(0, newTotal));
  if (excess <= 0) return [];
  const changes: { id: string; amount: number }[] = [];
  const newestFirst = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const row of newestFirst) {
    if (excess <= 0) break;
    const cut = Math.min(row.amount, excess);
    changes.push({ id: row.id, amount: roundToCents(row.amount - cut) });
    excess = roundToCents(excess - cut);
  }
  return changes;
}

export interface LedgerRowForOrder {
  entryType: "debit" | "credit";
  amount: number;
  orderId: string | null;
}

export function balanceExcludingOrderDebit(rows: LedgerRowForOrder[], orderId: string): number {
  return computeCustomerBalance(rows.filter((r) => !(r.entryType === "debit" && r.orderId === orderId)));
}

export interface BillLineEdit {
  qty?: number;
  price?: number;
}

export function validateBillLineEdit(edit: BillLineEdit): { ok: true } | { ok: false; error: string } {
  if (edit.qty === undefined && edit.price === undefined) return { ok: false, error: "Nothing to change." };
  // qty here is the billed qty: 0 is allowed (an item given free).
  if (edit.qty !== undefined && (!Number.isFinite(edit.qty) || edit.qty < 0)) {
    return { ok: false, error: "Quantity can't be negative." };
  }
  if (edit.price !== undefined && (!Number.isFinite(edit.price) || edit.price <= 0)) {
    return { ok: false, error: "Rate must be greater than zero." };
  }
  return { ok: true };
}
