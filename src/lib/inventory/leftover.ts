// Leftover-stock resolution for next-day procurement (migration 0030). Each
// evening's count is the authoritative current stock (fruit is perishable, so no
// multi-day rollover) -- procurement for a delivery date uses the most recent
// count strictly BEFORE it (the previous operating evening; robust to off-days).
// Pure function, unit-tested alongside the procurement aggregation.

export interface InventorySnapshotRow {
  as_of_date: string; // YYYY-MM-DD
  product_id: string;
  qty: number;
}

export interface LeftoverResult {
  asOfDate: string | null; // the count date used (shown in the UI), or null if none
  qtyByProduct: Map<string, number>;
}

// From all snapshot rows dated before `beforeDate`, pick the single most-recent
// count date and return its per-product leftover quantities.
export function pickLatestSnapshot(rows: InventorySnapshotRow[], beforeDate: string): LeftoverResult {
  let latest: string | null = null;
  for (const row of rows) {
    if (row.as_of_date < beforeDate && (latest === null || row.as_of_date > latest)) {
      latest = row.as_of_date;
    }
  }
  const qtyByProduct = new Map<string, number>();
  if (latest !== null) {
    for (const row of rows) {
      if (row.as_of_date === latest) qtyByProduct.set(row.product_id, row.qty);
    }
  }
  return { asOfDate: latest, qtyByProduct };
}
