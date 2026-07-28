// CLAUDE.md §2: bill computation is required money-logic testing. §3.2's
// guard -- "an order line whose product has no resolvable price... cannot
// proceed to billing until priced. Never silently bill at zero" -- means
// computeBillTotal must never fold an unpriced line into the total; it
// reports how many were skipped so the caller can block billing entirely.

export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface BillableLine {
  actualQty: number;
  lockedPricePerUnit: number | null;
}

export interface ComputedBill {
  total: number;
  unpricedLineCount: number;
}

export function computeBillTotal(lines: BillableLine[]): ComputedBill {
  let total = 0;
  let unpricedLineCount = 0;

  for (const line of lines) {
    if (line.lockedPricePerUnit === null) {
      unpricedLineCount += 1;
      continue;
    }
    total += line.actualQty * line.lockedPricePerUnit;
  }

  return { total: roundToCents(total), unpricedLineCount };
}

export interface LedgerEntryForBalance {
  entryType: "debit" | "credit";
  amount: number;
}

// + owed by the customer, - customer is in credit (advance).
export function computeCustomerBalance(entries: LedgerEntryForBalance[]): number {
  const balance = entries.reduce(
    (sum, entry) => sum + (entry.entryType === "debit" ? entry.amount : -entry.amount),
    0,
  );
  return roundToCents(balance);
}

export function computeNetDue(billTotal: number, prevBalance: number): number {
  return roundToCents(billTotal + prevBalance);
}
