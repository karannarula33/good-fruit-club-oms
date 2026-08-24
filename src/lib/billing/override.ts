// CLAUDE.md §3.1 locks an order line's price at order/substitution time
// and says it's "never recomputed... even if prices change later." An
// admin price override at billing time is a deliberate, audited exception
// to that rule, scoped to a single line on a single not-yet-billed order --
// these guards keep it from becoming a backdoor around the lock once a
// bill exists.

export interface PriceOverrideInput {
  newPrice: number;
  reason: string;
  orderStatus: string;
  lineStatus: string;
  hasBill: boolean;
}

export type PriceOverrideValidation = { ok: true } | { ok: false; error: string };

export function validatePriceOverride(input: PriceOverrideInput): PriceOverrideValidation {
  if (input.hasBill) {
    return { ok: false, error: "This order is already billed — price is locked in the bill." };
  }
  if (input.orderStatus !== "packed" || input.lineStatus !== "packed") {
    return { ok: false, error: "This line is no longer eligible for a price override." };
  }
  if (!Number.isFinite(input.newPrice) || input.newPrice <= 0) {
    return { ok: false, error: "Price must be greater than zero." };
  }
  if (input.reason.trim().length === 0) {
    return { ok: false, error: "A reason is required." };
  }
  return { ok: true };
}

// Same eligibility guards as validatePriceOverride, for correcting a
// packer's actual_qty entry at the same billing-time review step.
export interface QuantityOverrideInput {
  newQty: number;
  reason: string;
  orderStatus: string;
  lineStatus: string;
  hasBill: boolean;
}

export type QuantityOverrideValidation = { ok: true } | { ok: false; error: string };

export function validateQuantityOverride(input: QuantityOverrideInput): QuantityOverrideValidation {
  if (input.hasBill) {
    return { ok: false, error: "This order is already billed — quantity is locked in the bill." };
  }
  if (input.orderStatus !== "packed" || input.lineStatus !== "packed") {
    return { ok: false, error: "This line is no longer eligible for a quantity override." };
  }
  if (!Number.isFinite(input.newQty) || input.newQty <= 0) {
    return { ok: false, error: "Quantity must be greater than zero." };
  }
  if (input.reason.trim().length === 0) {
    return { ok: false, error: "A reason is required." };
  }
  return { ok: true };
}
