import { describe, expect, it } from "vitest";
import { aggregateProcurement, type ProcurementLine } from "@/lib/procurement/aggregate";

const MANGO = "product-mango";
const BANANA = "product-banana";

function line(productId: string, qty: number, customerName: string): ProcurementLine {
  return { productId, qty, customerName };
}

const NONE = new Map<string, number>();

describe("aggregateProcurement", () => {
  it("sums qty per product across multiple lines", () => {
    const lines = [line(MANGO, 1, "Rita"), line(MANGO, 1.5, "Karan")];
    const [row] = aggregateProcurement(lines, NONE);
    expect(row.totalQty).toBe(2.5);
  });

  it("keeps distinct products separate", () => {
    const lines = [line(MANGO, 2, "Rita"), line(BANANA, 5, "Rita")];
    const rows = aggregateProcurement(lines, NONE);
    expect(rows.find((r) => r.productId === MANGO)?.totalQty).toBe(2);
    expect(rows.find((r) => r.productId === BANANA)?.totalQty).toBe(5);
  });

  it("merges contributions per customer, sorted by qty desc then name", () => {
    const lines = [line(MANGO, 2, "Samander"), line(MANGO, 1, "Arjun"), line(MANGO, 2, "Karan")];
    const [row] = aggregateProcurement(lines, NONE);
    expect(row.contributions).toEqual([
      { customerName: "Karan", qty: 2 },
      { customerName: "Samander", qty: 2 },
      { customerName: "Arjun", qty: 1 },
    ]);
  });

  it("merges multiple lines from the same customer into one contribution", () => {
    const lines = [line(MANGO, 1, "Rita"), line(MANGO, 1, "Rita")];
    const [row] = aggregateProcurement(lines, NONE);
    expect(row.contributions).toEqual([{ customerName: "Rita", qty: 2 }]);
  });

  it("extraQty is 0 when the product was never checked", () => {
    const lines = [line(MANGO, 3, "Rita")];
    const [row] = aggregateProcurement(lines, NONE);
    expect(row.extraQty).toBe(0);
  });

  it("extraQty is 0 when checked and nothing has changed since", () => {
    const lines = [line(MANGO, 3, "Rita")];
    const [row] = aggregateProcurement(lines, new Map([[MANGO, 3]]));
    expect(row.extraQty).toBe(0);
  });

  it("extraQty is positive when more has been ordered since the item was checked", () => {
    const lines = [line(MANGO, 3, "Rita"), line(MANGO, 2, "Karan")];
    const [row] = aggregateProcurement(lines, new Map([[MANGO, 3]]));
    expect(row.totalQty).toBe(5);
    expect(row.extraQty).toBe(2);
  });

  it("floors extraQty at 0 if checkedQty is somehow ahead of the current total", () => {
    const lines = [line(MANGO, 1, "Rita")];
    const [row] = aggregateProcurement(lines, new Map([[MANGO, 5]]));
    expect(row.extraQty).toBe(0);
  });
});
