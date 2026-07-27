// CLAUDE.md §3.6: for a delivery date, aggregate ordered quantities by
// product, split into a base list (already conveyed to the vendor) and
// extras (the delta since). The split is always live: with no mark yet
// (listSentAt: null), everything is "extras" -- nothing has been conveyed.
// An order placed at the exact instant of marking counts as already
// conveyed (<=), matching what pressing the mark button actually captures.

export interface ProcurementLine {
  productId: string;
  qty: number;
  placedAt: Date;
}

export interface ProcurementAggregate {
  base: Map<string, number>;
  extras: Map<string, number>;
}

export function aggregateProcurement(
  lines: ProcurementLine[],
  listSentAt: Date | null,
): ProcurementAggregate {
  const base = new Map<string, number>();
  const extras = new Map<string, number>();

  for (const line of lines) {
    const isBase = listSentAt !== null && line.placedAt.getTime() <= listSentAt.getTime();
    const bucket = isBase ? base : extras;
    bucket.set(line.productId, (bucket.get(line.productId) ?? 0) + line.qty);
  }

  return { base, extras };
}
