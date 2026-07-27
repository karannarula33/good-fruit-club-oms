import { describe, expect, it } from "vitest";
import { aggregateProcurement, type ProcurementLine } from "@/lib/procurement/aggregate";

const MANGO = "product-mango";
const BANANA = "product-banana";

function line(productId: string, qty: number, placedAt: string): ProcurementLine {
  return { productId, qty, placedAt: new Date(placedAt) };
}

describe("aggregateProcurement", () => {
  it("puts everything in extras when no mark exists yet", () => {
    const lines = [line(MANGO, 2, "2026-07-27T10:00:00Z"), line(BANANA, 1, "2026-07-27T11:00:00Z")];
    const { base, extras } = aggregateProcurement(lines, null);
    expect(base.size).toBe(0);
    expect(extras.get(MANGO)).toBe(2);
    expect(extras.get(BANANA)).toBe(1);
  });

  it("splits by placedAt relative to listSentAt", () => {
    const listSentAt = new Date("2026-07-27T12:00:00Z");
    const lines = [
      line(MANGO, 2, "2026-07-27T10:00:00Z"), // before mark -> base
      line(MANGO, 1, "2026-07-27T14:00:00Z"), // after mark -> extras
    ];
    const { base, extras } = aggregateProcurement(lines, listSentAt);
    expect(base.get(MANGO)).toBe(2);
    expect(extras.get(MANGO)).toBe(1);
  });

  it("treats an order placed exactly at listSentAt as base (inclusive)", () => {
    const listSentAt = new Date("2026-07-27T12:00:00Z");
    const lines = [line(MANGO, 3, "2026-07-27T12:00:00.000Z")];
    const { base, extras } = aggregateProcurement(lines, listSentAt);
    expect(base.get(MANGO)).toBe(3);
    expect(extras.has(MANGO)).toBe(false);
  });

  it("sums multiple lines for the same product within a bucket", () => {
    const lines = [line(MANGO, 1, "2026-07-27T09:00:00Z"), line(MANGO, 1.5, "2026-07-27T09:30:00Z")];
    const { extras } = aggregateProcurement(lines, null);
    expect(extras.get(MANGO)).toBe(2.5);
  });

  it("keeps distinct products separate", () => {
    const lines = [line(MANGO, 2, "2026-07-27T09:00:00Z"), line(BANANA, 5, "2026-07-27T09:00:00Z")];
    const { extras } = aggregateProcurement(lines, null);
    expect(extras.get(MANGO)).toBe(2);
    expect(extras.get(BANANA)).toBe(5);
  });
});
