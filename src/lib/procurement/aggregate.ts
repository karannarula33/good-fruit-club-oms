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
  // Leftover-stock netting (migration 0030): what's already on hand from the
  // previous evening's count, what still needs buying after subtracting it, and
  // any surplus (leftover beyond what's ordered). leftoverQty defaults to 0.
  leftoverQty: number;
  toProcureQty: number;
  surplusQty: number;
  contributions: ProcurementContribution[];
}

// Orders typed in grams ("500 g") are stored with ordered_qty 500 and unit
// "g". Procurement totals are in kg, so grams are converted here; every other
// unit (kg, box, pc, tube, dozen...) is summed as entered.
const GRAM_UNITS = new Set(["g", "gm", "gms", "gram", "grams", "gr"]);
export function procurementQty(qty: number, orderedUnit: string | null | undefined): number {
  return GRAM_UNITS.has((orderedUnit ?? "").trim().toLowerCase()) ? round3(qty / 1000) : qty;
}

export function aggregateProcurement(
  lines: ProcurementLine[],
  checkedQtyByProduct: Map<string, number>,
  leftoverQtyByProduct: Map<string, number> = new Map(),
): ProcurementRow[] {
  const totals = new Map<string, number>();
  const contributionsByProduct = new Map<string, Map<string, number>>();

  for (const line of lines) {
    totals.set(line.productId, round3((totals.get(line.productId) ?? 0) + line.qty));

    const contributions = contributionsByProduct.get(line.productId) ?? new Map<string, number>();
    contributions.set(line.customerName, round3((contributions.get(line.customerName) ?? 0) + line.qty));
    contributionsByProduct.set(line.productId, contributions);
  }

  // Products with leftover but no orders today still surface (demand 0) so the
  // admin sees "you have N on hand, nothing ordered" rather than it vanishing.
  const productIds = new Set<string>([...totals.keys(), ...leftoverQtyByProduct.keys()]);

  return [...productIds].map((productId) => {
    const totalQty = totals.get(productId) ?? 0;
    const checkedQty = checkedQtyByProduct.get(productId);
    const extraQty = checkedQty !== undefined ? Math.max(0, round3(totalQty - checkedQty)) : 0;
    const leftoverQty = leftoverQtyByProduct.get(productId) ?? 0;
    const toProcureQty = Math.max(0, round3(totalQty - leftoverQty));
    const surplusQty = Math.max(0, round3(leftoverQty - totalQty));
    const contributions = [...(contributionsByProduct.get(productId) ?? new Map())]
      .map(([customerName, qty]) => ({ customerName, qty }))
      .sort((a, b) => b.qty - a.qty || a.customerName.localeCompare(b.customerName));
    return { productId, totalQty, extraQty, leftoverQty, toProcureQty, surplusQty, contributions };
  });
}
