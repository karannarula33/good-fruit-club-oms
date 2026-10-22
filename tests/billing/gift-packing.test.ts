import { describe, expect, it } from "vitest";
import { countGiftPackings, giftPackingBillLine, giftPackingCharge, GIFT_PACKING_RATE } from "@/lib/billing/gift-packing";

const packages = [
  { id: "g1", packaging_type: "gift_packing" },
  { id: "g2", packaging_type: "gift_packing" },
  { id: "b1", packaging_type: "big_box" },
];

describe("gift packing charge", () => {
  it("is ₹400 per gift packing", () => {
    expect(GIFT_PACKING_RATE).toBe(400);
    expect(giftPackingCharge(2)).toBe(800);
  });

  it("counts each gift packing once, however many items are in it", () => {
    const lines = [{ package_id: "g1" }, { package_id: "g1" }, { package_id: "b1" }, { package_id: null }];
    expect(countGiftPackings(lines, packages)).toBe(1);
  });

  it("only counts gift packings that hold a packed item", () => {
    expect(countGiftPackings([{ package_id: "b1" }], packages)).toBe(0);
    expect(countGiftPackings([{ package_id: "g1" }, { package_id: "g2" }], packages)).toBe(2);
  });

  it("adds a bill line only when there is gift packing", () => {
    expect(giftPackingBillLine(0)).toBeNull();
    expect(giftPackingBillLine(2)).toEqual({ productName: "Gift Packing", actualQty: 2, unitLabel: null, ratePerUnit: 400, amount: 800 });
  });
});
