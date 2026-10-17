import { describe, expect, it } from "vitest";
import { billedQuantity, validateBilledQty } from "@/lib/billing/qty";
import { computeBillTotal } from "@/lib/billing/compute";

describe("billed quantity", () => {
  it("defaults to the packed quantity until someone sets it", () => {
    expect(billedQuantity({ actualQty: 1.25, billedQty: null })).toBe(1.25);
    expect(billedQuantity({ actualQty: null, billedQty: null })).toBeNull();
  });

  it("uses the billed quantity once set, even if it differs from packed", () => {
    expect(billedQuantity({ actualQty: 1.25, billedQty: 1 })).toBe(1);
    expect(billedQuantity({ actualQty: 1, billedQty: 0 })).toBe(0); // given free
  });

  it("bills on billed qty while packed qty is untouched", () => {
    const line = { actualQty: 1.25, billedQty: 1.05 };
    const { total } = computeBillTotal([{ actualQty: billedQuantity(line)!, lockedPricePerUnit: 990 }]);
    expect(total).toBe(1040);
    expect(line.actualQty).toBe(1.25);
  });

  it("allows zero (a free item) but not negative", () => {
    expect(validateBilledQty(0)).toEqual({ ok: true });
    expect(validateBilledQty(-0.5).ok).toBe(false);
    expect(validateBilledQty(Number.NaN).ok).toBe(false);
  });
});
