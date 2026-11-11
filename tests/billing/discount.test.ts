import { describe, expect, it } from "vitest";
import { applyDiscount, discountAmount, discountLabel, toOrderDiscount, validateDiscount } from "@/lib/billing/discount";
import { buildBillMessage } from "@/lib/billing/message";

describe("discountAmount", () => {
  it("takes a flat amount off", () => expect(discountAmount(1500, { type: "amount", value: 200 })).toBe(200));
  it("caps a flat amount at the subtotal", () => expect(discountAmount(150, { type: "amount", value: 200 })).toBe(150));
  it("rounds a percentage to the whole rupee", () => {
    expect(discountAmount(1234, { type: "percent", value: 10 })).toBe(123);
    expect(discountAmount(1235, { type: "percent", value: 10 })).toBe(124);
  });
  it("100% makes the bill free", () => expect(applyDiscount(980, { type: "percent", value: 100 }).total).toBe(0));
  it("no discount, or nothing to discount", () => {
    expect(discountAmount(500, null)).toBe(0);
    expect(discountAmount(0, { type: "amount", value: 50 })).toBe(0);
  });
  it("applies to the subtotal including gift packing", () => {
    expect(applyDiscount(1000 + 400, { type: "percent", value: 10 })).toEqual({ subtotal: 1400, discount: 140, total: 1260 });
  });
});

describe("validateDiscount", () => {
  it("accepts ₹ and % with a reason", () => {
    expect(validateDiscount({ type: "amount", value: 100, reason: "regular member" }).ok).toBe(true);
    expect(validateDiscount({ type: "percent", value: 15, reason: " late  delivery " })).toEqual({
      ok: true, discount: { type: "percent", value: 15 }, reason: "late delivery",
    });
  });
  it("rejects bad values and missing reasons", () => {
    expect(validateDiscount({ type: "percent", value: 120, reason: "abc" }).ok).toBe(false);
    expect(validateDiscount({ type: "amount", value: 0, reason: "abc" }).ok).toBe(false);
    expect(validateDiscount({ type: "amount", value: NaN, reason: "abc" }).ok).toBe(false);
    expect(validateDiscount({ type: "amount", value: 50, reason: " " }).ok).toBe(false);
    expect(validateDiscount({ type: "other", value: 50, reason: "abc" }).ok).toBe(false);
  });
});

describe("toOrderDiscount / labels", () => {
  it("reads the order columns", () => {
    expect(toOrderDiscount("percent", "10.00")).toEqual({ type: "percent", value: 10 });
    expect(toOrderDiscount(null, null)).toBeNull();
    expect(toOrderDiscount("amount", 0)).toBeNull();
  });
  it("labels", () => {
    expect(discountLabel({ type: "percent", value: 10 })).toBe("Discount (10%)");
    expect(discountLabel({ type: "amount", value: 200 })).toBe("Discount");
  });
});

describe("bill message with a discount", () => {
  const base = {
    salutation: "Sir" as const,
    deliveryDate: "2026-11-11",
    lines: [{ productName: "Kiwi", actualQty: 10, unitLabel: "piece", ratePerUnit: 50, amount: 500 }],
    prevBalance: 0,
  };
  it("shows subtotal and discount above the order total", () => {
    const text = buildBillMessage({ ...base, total: 450, netDue: 450, discount: { label: "Discount (10%)", amount: 50 } });
    expect(text).toContain("Subtotal: ₹500\nDiscount (10%): −₹50\nOrder total: ₹450");
    expect(text).toContain("Net amount due: ₹450");
  });
  it("is unchanged without one", () => {
    const text = buildBillMessage({ ...base, total: 500, netDue: 500 });
    expect(text).not.toContain("Subtotal");
    expect(text).not.toContain("Discount");
  });
});
