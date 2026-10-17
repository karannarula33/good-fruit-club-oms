// Packed vs billed quantity (migration 0036, admin 2026-10-17). actual_qty is
// what was physically packed and drives COGS; billed_qty is what the customer
// pays for and drives the bill and revenue. An unset billed_qty means "same
// as packed", so lines nobody touched bill exactly as before.

export function billedQuantity(line: { actualQty: number | null; billedQty: number | null }): number | null {
  return line.billedQty ?? line.actualQty;
}

export function validateBilledQty(qty: number): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(qty) || qty < 0) return { ok: false, error: "Billed quantity can't be negative." };
  return { ok: true };
}
