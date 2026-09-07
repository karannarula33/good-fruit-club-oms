// Daily order -> Google Sheets sync: an order's total packaging/delivery
// cost is split evenly across its line items for the sheet -- matches the
// historical sheet's own convention (a multi-line order shows the same
// Pkg Cost / Delivery value repeated on every one of its lines).

export function splitCostAcrossLines(totalCost: number, lineCount: number): number {
  if (lineCount <= 0) return 0;
  return Math.round((totalCost / lineCount) * 100) / 100;
}
