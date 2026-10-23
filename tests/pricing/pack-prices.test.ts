import { describe, expect, it } from "vitest";
import { itemToPackPrices, KG_RATE_FROM_QTY, packPricesToItem } from "@/lib/pricing/pack-prices";
import { resolveTieredPriceForProduct, type PriceItemRecord, type TierRecord } from "@/lib/pricing/resolve";
import { roundLineAmount } from "@/lib/billing/compute";

describe("500g / 1 kg pack prices", () => {
  it("stores ₹600/500g + ₹1,150/kg as ₹1,200/kg with a 0.7 kg tier at ₹1,150", () => {
    expect(packPricesToItem(1150, 600)).toEqual({ pricePerUnit: 1200, tiers: [{ minQty: 0.7, pricePerUnit: 1150 }] });
  });

  it("a plain kg price has no tier; a 500g-only price doubles with no tier", () => {
    expect(packPricesToItem(540, null)).toEqual({ pricePerUnit: 540, tiers: [] });
    expect(packPricesToItem(null, 400)).toEqual({ pricePerUnit: 800, tiers: [] });
    expect(packPricesToItem(900, 450)).toEqual({ pricePerUnit: 900, tiers: [] });
    expect(packPricesToItem(null, null)).toBeNull();
  });

  it("reads back for display", () => {
    expect(itemToPackPrices(1200, [{ minQty: KG_RATE_FROM_QTY, pricePerUnit: 1150 }])).toEqual({ halfKgPrice: 600, kgPrice: 1150 });
    expect(itemToPackPrices(540, [])).toBeNull();
  });

  it("bills below 0.7 kg at the 500g rate and from 0.7 kg at the 1 kg rate, no tiers above", () => {
    const item = packPricesToItem(1150, 600)!;
    const items: PriceItemRecord[] = [{ priceItemId: "pi", productId: "p", pricePerUnit: item.pricePerUnit, effectiveFrom: new Date(0), versionCreatedAt: new Date(0) }];
    const tiers: TierRecord[] = item.tiers.map((t) => ({ priceItemId: "pi", ...t }));
    const bill = (qty: number) => roundLineAmount(qty, resolveTieredPriceForProduct(items, tiers, "p", new Date(), qty)!.pricePerUnit);
    expect(bill(0.5)).toBe(600);
    expect(bill(0.65)).toBe(780);
    expect(bill(0.7)).toBe(805);
    expect(bill(1)).toBe(1150);
    expect(bill(2)).toBe(2300);
  });
});
