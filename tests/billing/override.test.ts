import { describe, expect, it } from "vitest";
import { validatePriceOverride, validateQuantityOverride } from "@/lib/billing/override";

const base = {
  newPrice: 120,
  reason: "Vendor corrected today's rate after publish",
  orderStatus: "packed",
  lineStatus: "packed",
  hasBill: false,
};

describe("validatePriceOverride", () => {
  it("allows a positive price with a reason on a packed, unbilled line", () => {
    expect(validatePriceOverride(base)).toEqual({ ok: true });
  });

  it("rejects when the order is already billed", () => {
    const result = validatePriceOverride({ ...base, hasBill: true });
    expect(result).toEqual({ ok: false, error: "This order is already billed — price is locked in the bill." });
  });

  it("rejects when the order is not in packed status", () => {
    const result = validatePriceOverride({ ...base, orderStatus: "dispatched" });
    expect(result.ok).toBe(false);
  });

  it("rejects when the line itself is not packed", () => {
    const result = validatePriceOverride({ ...base, lineStatus: "unavailable" });
    expect(result.ok).toBe(false);
  });

  it("rejects zero or negative prices", () => {
    expect(validatePriceOverride({ ...base, newPrice: 0 }).ok).toBe(false);
    expect(validatePriceOverride({ ...base, newPrice: -5 }).ok).toBe(false);
  });

  it("rejects non-finite prices", () => {
    expect(validatePriceOverride({ ...base, newPrice: NaN }).ok).toBe(false);
  });

  it("rejects an empty or whitespace-only reason", () => {
    expect(validatePriceOverride({ ...base, reason: "" }).ok).toBe(false);
    expect(validatePriceOverride({ ...base, reason: "   " }).ok).toBe(false);
  });
});

const qtyBase = {
  newQty: 2.5,
  reason: "Packer mis-entered the weight, corrected against the packing sheet",
  orderStatus: "packed",
  lineStatus: "packed",
  hasBill: false,
};

describe("validateQuantityOverride", () => {
  it("allows a positive quantity with a reason on a packed, unbilled line", () => {
    expect(validateQuantityOverride(qtyBase)).toEqual({ ok: true });
  });

  it("rejects when the order is already billed", () => {
    const result = validateQuantityOverride({ ...qtyBase, hasBill: true });
    expect(result).toEqual({
      ok: false,
      error: "This order is already billed — quantity is locked in the bill.",
    });
  });

  it("rejects when the order is not in packed status", () => {
    const result = validateQuantityOverride({ ...qtyBase, orderStatus: "dispatched" });
    expect(result.ok).toBe(false);
  });

  it("rejects when the line itself is not packed", () => {
    const result = validateQuantityOverride({ ...qtyBase, lineStatus: "unavailable" });
    expect(result.ok).toBe(false);
  });

  it("rejects zero or negative quantities", () => {
    expect(validateQuantityOverride({ ...qtyBase, newQty: 0 }).ok).toBe(false);
    expect(validateQuantityOverride({ ...qtyBase, newQty: -1 }).ok).toBe(false);
  });

  it("rejects non-finite quantities", () => {
    expect(validateQuantityOverride({ ...qtyBase, newQty: NaN }).ok).toBe(false);
  });

  it("rejects an empty or whitespace-only reason", () => {
    expect(validateQuantityOverride({ ...qtyBase, reason: "" }).ok).toBe(false);
    expect(validateQuantityOverride({ ...qtyBase, reason: "   " }).ok).toBe(false);
  });
});
