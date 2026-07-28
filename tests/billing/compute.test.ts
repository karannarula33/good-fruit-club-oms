import { describe, expect, it } from "vitest";
import { computeBillTotal, computeCustomerBalance, computeNetDue, derivePaymentStatus } from "@/lib/billing/compute";

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

  it("rounds decimal-prone quantities correctly", () => {
    const { total } = computeBillTotal([{ actualQty: 2.06, lockedPricePerUnit: 295 }]);
    expect(total).toBe(607.7);
  });

  it("returns zero total for no lines", () => {
    expect(computeBillTotal([])).toEqual({ total: 0, unpricedLineCount: 0 });
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
