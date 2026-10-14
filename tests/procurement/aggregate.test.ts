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

describe("aggregateProcurement — leftover netting", () => {
  it("defaults to no leftover (toProcure = demand) when no map is passed", () => {
    const [row] = aggregateProcurement([line(MANGO, 3, "Rita")], NONE);
    expect(row.leftoverQty).toBe(0);
    expect(row.toProcureQty).toBe(3);
    expect(row.surplusQty).toBe(0);
  });

  it("subtracts leftover from demand", () => {
    const [row] = aggregateProcurement([line(MANGO, 3, "Rita")], NONE, new Map([[MANGO, 1.2]]));
    expect(row.leftoverQty).toBe(1.2);
    expect(row.toProcureQty).toBe(1.8);
    expect(row.surplusQty).toBe(0);
  });

  it("floors toProcure at 0 and reports surplus when leftover exceeds demand", () => {
    const [row] = aggregateProcurement([line(MANGO, 2, "Rita")], NONE, new Map([[MANGO, 5]]));
    expect(row.toProcureQty).toBe(0);
    expect(row.surplusQty).toBe(3);
  });

  it("surfaces a leftover-only product (no orders) as a surplus row with demand 0", () => {
    const rows = aggregateProcurement([line(MANGO, 2, "Rita")], NONE, new Map([[BANANA, 4]]));
    const banana = rows.find((r) => r.productId === BANANA);
    expect(banana).toBeDefined();
    expect(banana?.totalQty).toBe(0);
    expect(banana?.toProcureQty).toBe(0);
    expect(banana?.surplusQty).toBe(4);
  });

  it("rounds the netted quantity to 3 dp", () => {
    const [row] = aggregateProcurement([line(MANGO, 2.555, "Rita")], NONE, new Map([[MANGO, 1.11]]));
    expect(row.toProcureQty).toBe(1.445);
  });
});

describe("procurementQty", () => {
  it("converts grams to kg and leaves every other unit as entered", async () => {
    const { procurementQty } = await import("@/lib/procurement/aggregate");
    expect(procurementQty(500, "g")).toBe(0.5);
    expect(procurementQty(250, "Gms")).toBe(0.25);
    expect(procurementQty(1, "kg")).toBe(1);
    expect(procurementQty(2, "box")).toBe(2);
    expect(procurementQty(3, null)).toBe(3);
  });
});
