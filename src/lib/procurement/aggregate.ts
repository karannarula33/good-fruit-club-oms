// CLAUDE.md §3.6: for a delivery date, aggregate ordered quantities by
// product into a single checklist. "Sent to vendor" is tracked per item
// (procurement_item_checks), not by a single day-level moment -- so there's
// no base/extras split here. Instead, checking an item snapshots the
// product's current total into checked_qty; extraQty is how much has been
// ordered since that snapshot (0 if never checked, or if nothing's changed).
// That's the signal to convey a delta to the vendor without unchecking the
// whole row.

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface ProcurementLine {
  productId: string;
  qty: number;
  customerName: string;
}

export interface ProcurementContribution {
  customerName: string;
  qty: number;
}

export interface ProcurementRow {
  productId: string;
  totalQty: number;
  extraQty: number;
  contributions: ProcurementContribution[];
}

export function aggregateProcurement(
  lines: ProcurementLine[],
  checkedQtyByProduct: Map<string, number>,
): ProcurementRow[] {
  const totals = new Map<string, number>();
  const contributionsByProduct = new Map<string, Map<string, number>>();

  for (const line of lines) {
    totals.set(line.productId, round3((totals.get(line.productId) ?? 0) + line.qty));

    const contributions = contributionsByProduct.get(line.productId) ?? new Map<string, number>();
    contributions.set(line.customerName, round3((contributions.get(line.customerName) ?? 0) + line.qty));
    contributionsByProduct.set(line.productId, contributions);
  }

  return [...totals.entries()].map(([productId, totalQty]) => {
    const checkedQty = checkedQtyByProduct.get(productId);
    const extraQty = checkedQty !== undefined ? Math.max(0, round3(totalQty - checkedQty)) : 0;
    const contributions = [...(contributionsByProduct.get(productId) ?? new Map())]
      .map(([customerName, qty]) => ({ customerName, qty }))
      .sort((a, b) => b.qty - a.qty || a.customerName.localeCompare(b.customerName));
    return { productId, totalQty, extraQty, contributions };
  });
}
