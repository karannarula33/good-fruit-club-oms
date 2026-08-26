import { describe, expect, it } from "vitest";
import {
  computeBillTotal,
  computeCustomerBalance,
  computeNetDue,
  derivePaymentStatus,
  roundLineAmount,
} from "@/lib/billing/compute";

describe("computeBillTotal", () => {
  it("sums qty * price across lines", () => {
    const { total, unpricedLineCount } = computeBillTotal([
      { actualQty: 2, lockedPricePerUnit: 295 },
      { actualQty: 1, lockedPricePerUnit: 750 },
    ]);
    expect(total).toBe(1340);
    expect(unpricedLineCount).toBe(0);
  });

  it("excludes unpriced lines from the total and reports how many were skipped", () => {
    const { total, unpricedLineCount } = computeBillTotal([
      { actualQty: 2, lockedPricePerUnit: 295 },
      { actualQty: 1, lockedPricePerUnit: null },
    ]);
    expect(total).toBe(590);
    expect(unpricedLineCount).toBe(1);
  });

  it("rounds each line to the nearest whole rupee before summing", () => {
    const { total } = computeBillTotal([{ actualQty: 2.06, lockedPricePerUnit: 295 }]);
    expect(total).toBe(608); // 607.7 rounds up to 608
  });

  it("sums per-line roundings rather than rounding the total once", () => {
    const { total } = computeBillTotal([
      { actualQty: 1.5, lockedPricePerUnit: 33 }, // 49.5 -> 50
      { actualQty: 0.5, lockedPricePerUnit: 41 }, // 20.5 -> 21
    ]);
    expect(total).toBe(71);
  });

  it("returns zero total for no lines", () => {
    expect(computeBillTotal([])).toEqual({ total: 0, unpricedLineCount: 0 });
  });
});

describe("roundLineAmount", () => {
  it("rounds up at or above the half-rupee", () => {
    expect(roundLineAmount(2.06, 295)).toBe(608); // 607.7
  });

  it("rounds down below the half-rupee", () => {
    expect(roundLineAmount(1, 100.4)).toBe(100);
  });
});

describe("computeCustomerBalance", () => {
  it("is zero with no entries", () => {
    expect(computeCustomerBalance([])).toBe(0);
  });

  it("is positive when debits exceed credits (customer owes)", () => {
    const balance = computeCustomerBalance([
      { entryType: "debit", amount: 1000 },
      { entryType: "credit", amount: 400 },
    ]);
    expect(balance).toBe(600);
  });

  it("is negative when credits exceed debits (customer has an advance)", () => {
    const balance = computeCustomerBalance([
      { entryType: "debit", amount: 200 },
      { entryType: "credit", amount: 500 },
    ]);
    expect(balance).toBe(-300);
  });
});

describe("computeNetDue", () => {
  it("adds a positive previous balance to the bill total", () => {
    expect(computeNetDue(500, 200)).toBe(700);
  });

  it("reduces net due when the previous balance is negative (an advance)", () => {
    expect(computeNetDue(500, -200)).toBe(300);
  });

  it("can go negative when an advance exceeds the new bill", () => {
    expect(computeNetDue(100, -500)).toBe(-400);
  });
});

describe("derivePaymentStatus", () => {
  it("is unpaid when nothing has been allocated", () => {
    expect(derivePaymentStatus(500, 0)).toBe("unpaid");
  });

  it("is partial when some but not all has been allocated", () => {
    expect(derivePaymentStatus(500, 200)).toBe("partial");
  });

  it("is paid when the allocated amount meets the bill total", () => {
    expect(derivePaymentStatus(500, 500)).toBe("paid");
  });

  it("is paid when over-allocated", () => {
    expect(derivePaymentStatus(500, 600)).toBe("paid");
  });
});
