import { describe, expect, it } from "vitest";
import { balanceExcludingOrderDebit, planAllocationTrim, validateBillLineEdit } from "@/lib/billing/edit";

describe("editing a generated bill: allocations", () => {
  const rows = [
    { id: "old", amount: 500, createdAt: "2026-10-01T10:00:00Z" },
    { id: "new", amount: 300, createdAt: "2026-10-05T10:00:00Z" },
  ];

  it("leaves allocations alone when the new total still covers them", () => {
    expect(planAllocationTrim(rows, 800)).toEqual([]);
    expect(planAllocationTrim(rows, 1200)).toEqual([]);
  });

  it("trims the newest allocation first", () => {
    expect(planAllocationTrim(rows, 700)).toEqual([{ id: "new", amount: 200 }]);
  });

  it("removes a whole allocation and cuts into the next when needed", () => {
    expect(planAllocationTrim(rows, 350)).toEqual([
      { id: "new", amount: 0 },
      { id: "old", amount: 350 },
    ]);
  });

  it("frees everything when the bill drops to zero", () => {
    expect(planAllocationTrim(rows, 0)).toEqual([
      { id: "new", amount: 0 },
      { id: "old", amount: 0 },
    ]);
  });

  it("handles paise without drift", () => {
    expect(planAllocationTrim([{ id: "a", amount: 100.1, createdAt: "x" }], 99.95)).toEqual([{ id: "a", amount: 99.95 }]);
  });
});

describe("editing a generated bill: previous balance", () => {
  it("is the whole account except this order's own debit", () => {
    const ledger = [
      { entryType: "debit" as const, amount: 1000, orderId: "this" },
      { entryType: "debit" as const, amount: 600, orderId: "older" },
      { entryType: "credit" as const, amount: 400, orderId: null },
    ];
    expect(balanceExcludingOrderDebit(ledger, "this")).toBe(200);
    expect(balanceExcludingOrderDebit(ledger, "older")).toBe(600);
  });

  it("is negative when the customer has an advance", () => {
    expect(balanceExcludingOrderDebit([{ entryType: "credit", amount: 250, orderId: null }], "this")).toBe(-250);
  });
});

describe("editing a generated bill: input checks", () => {
  it("accepts a qty or a rate change", () => {
    expect(validateBillLineEdit({ qty: 1.25 })).toEqual({ ok: true });
    expect(validateBillLineEdit({ price: 340 })).toEqual({ ok: true });
  });
  it("rejects empty, zero or negative values", () => {
    expect(validateBillLineEdit({}).ok).toBe(false);
    expect(validateBillLineEdit({ qty: 0 }).ok).toBe(false);
    expect(validateBillLineEdit({ price: -1 }).ok).toBe(false);
    expect(validateBillLineEdit({ qty: Number.NaN }).ok).toBe(false);
  });
});
