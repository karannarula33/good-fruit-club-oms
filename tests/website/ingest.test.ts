import { describe, expect, it } from "vitest";
import { parseWebsiteOrder, phoneKey, planLines, siteOrderNumbers, unitsMatch, websiteOrderText } from "@/lib/website/ingest";
import { planAdvanceAllocation } from "@/lib/billing/allocate";
import { deliveryBillLine } from "@/lib/billing/delivery";

const body = (o: Record<string, unknown> = {}) => ({
  order_no: "GFC-1042",
  placed_at: "2026-11-11T03:00:00.000Z",
  payment_mode: "COD",
  payment_status: "pending",
  customer: { name: "Rita Parkash", phone: "98100 12345", address: "H-12, DLF Phase 2", pincode: "122002" },
  lines: [{ name: "Kinnaur Apple", qty: 1.5, unit: "kg", price_per_unit: 280 }],
  delivery_fee: 49,
  total: 469,
  ...o,
});

describe("parseWebsiteOrder", () => {
  it("accepts a COD order", () => {
    const r = parseWebsiteOrder(body());
    expect(r.ok && r.order).toMatchObject({ orderNo: "GFC-1042", paymentMode: "COD", paid: false, deliveryFee: 49, total: 469 });
  });
  it("accepts a paid online order and refuses an unpaid one", () => {
    expect(parseWebsiteOrder(body({ payment_mode: "ONLINE", payment_status: "paid" })).ok).toBe(true);
    expect(parseWebsiteOrder(body({ payment_mode: "ONLINE", payment_status: "pending" })).ok).toBe(false);
    const sent = parseWebsiteOrder(body({ payment_mode: "ONLINE", payment_status: "unpaid", admin_confirmed: true }));
    expect(sent.ok && sent.order.paid).toBe(false);
  });
  it("rejects bad input", () => {
    expect(parseWebsiteOrder(body({ order_no: "1042" })).ok).toBe(false);
    expect(parseWebsiteOrder(body({ lines: [] })).ok).toBe(false);
    expect(parseWebsiteOrder(body({ lines: [{ name: "Kiwi", qty: 0, unit: "box", price_per_unit: 1 }] })).ok).toBe(false);
    expect(parseWebsiteOrder(body({ customer: { name: "A", phone: "123", address: "x" } })).ok).toBe(false);
    expect(parseWebsiteOrder(null).ok).toBe(false);
  });
});

describe("phoneKey", () => {
  it("matches however it's written", () => {
    expect(phoneKey("+91 98100 12345")).toBe("9810012345");
    expect(phoneKey("09810012345")).toBe("9810012345");
    expect(phoneKey("9810012345")).toBe("9810012345");
    expect(phoneKey("12345")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });
});

describe("planLines", () => {
  const catalog = [
    { id: "apple", name: "Kinnaur Apple", aliases: [], unitLabel: "kg" },
    { id: "nz", name: "Apple (New Zealand)", aliases: ["New Zealand Queen Apple"], unitLabel: "kg" },
    { id: "muscat", name: "Muscat Grapes", aliases: [], unitLabel: "kg" },
    { id: "avocado", name: "Avocado", aliases: ["Hass Avocado"], unitLabel: "Piece" },
  ];
  it("keeps the site price when units match (by name or alias)", () => {
    const [a, b, c] = planLines(
      [
        { name: "Kinnaur Apple", qty: 1.5, unit: "kg", pricePerUnit: 280 },
        { name: "new zealand queen apple", qty: 1, unit: "kg", pricePerUnit: 480 },
        { name: "Hass Avocado", qty: 2, unit: "pc", pricePerUnit: 150 },
      ],
      catalog,
    );
    expect(a).toMatchObject({ productId: "apple", lockedPrice: 280, keepSitePrice: true, flagged: false });
    expect(b).toMatchObject({ productId: "nz", lockedPrice: 480, keepSitePrice: true });
    expect(c).toMatchObject({ productId: "avocado", orderedUnit: "Piece", lockedPrice: 150, keepSitePrice: true });
  });
  it("a unit mismatch is flagged and priced from the OMS list", () => {
    const [l] = planLines([{ name: "Muscat Grapes", qty: 1, unit: "box", pricePerUnit: 300 }], catalog);
    expect(l).toMatchObject({ productId: "muscat", lockedPrice: null, keepSitePrice: false, flagged: true });
    expect(l.note).toContain("box");
  });
  it("an unknown item comes back without a product", () => {
    const [l] = planLines([{ name: "Fuyu Persimmon", qty: 1, unit: "kg", pricePerUnit: 400 }], catalog);
    expect(l).toMatchObject({ productId: null, flagged: true, lockedPrice: 400 });
  });
});

describe("helpers", () => {
  it("units", () => {
    expect(unitsMatch("pc", "Piece")).toBe(true);
    expect(unitsMatch("tube", "Tube")).toBe(true);
    expect(unitsMatch("box", "kg")).toBe(false);
    expect(unitsMatch(null, "kg")).toBe(false);
  });
  it("order text carries the site number (the channel trigger reads it)", () => {
    const r = parseWebsiteOrder(body());
    expect(r.ok && websiteOrderText(r.order)).toContain("GFC-1042");
  });
  it("finds site numbers in a paste", () => {
    expect(siteOrderNumbers("Order gfc-1042 and GFC-1042, GFC-77")).toEqual(["GFC-1042"]);
  });
  it("delivery line", () => {
    expect(deliveryBillLine(49)).toMatchObject({ productName: "Delivery", amount: 49 });
    expect(deliveryBillLine(0)).toBeNull();
  });
});

describe("a website order's own payment goes to its bill first", () => {
  const advances = [
    { ledgerEntryId: "old", amount: 200, allocatedSoFar: 0, createdAt: new Date("2026-10-01") },
    { ledgerEntryId: "site", amount: 469, allocatedSoFar: 0, createdAt: new Date("2026-11-11") },
  ];
  it("uses the prepaid credit before older advances", () => {
    expect(planAdvanceAllocation({ advances, billTotal: 500, priorityId: "site" })).toEqual([
      { ledgerEntryId: "site", amount: 469 },
      { ledgerEntryId: "old", amount: 31 },
    ]);
  });
  it("oldest first without one (unchanged)", () => {
    expect(planAdvanceAllocation({ advances, billTotal: 300 })[0]).toEqual({ ledgerEntryId: "old", amount: 200 });
  });
});
