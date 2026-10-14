import { describe, expect, it } from "vitest";
import { pickLatestSnapshot, type InventorySnapshotRow } from "@/lib/inventory/leftover";

const row = (as_of_date: string, product_id: string, qty: number): InventorySnapshotRow => ({ as_of_date, product_id, qty });

describe("pickLatestSnapshot", () => {
  it("returns an empty result when there are no rows before the date", () => {
    const res = pickLatestSnapshot([row("2026-10-02", "a", 3)], "2026-10-02");
    expect(res.asOfDate).toBeNull();
    expect(res.qtyByProduct.size).toBe(0);
  });

  it("picks the most recent count strictly before the delivery date", () => {
    const rows = [
      row("2026-09-30", "a", 1),
      row("2026-10-01", "a", 2),
      row("2026-10-01", "b", 5),
    ];
    const res = pickLatestSnapshot(rows, "2026-10-02");
    expect(res.asOfDate).toBe("2026-10-01");
    expect(res.qtyByProduct.get("a")).toBe(2);
    expect(res.qtyByProduct.get("b")).toBe(5);
  });

  it("ignores counts on or after the delivery date", () => {
    const rows = [row("2026-10-01", "a", 2), row("2026-10-02", "a", 9)];
    const res = pickLatestSnapshot(rows, "2026-10-02");
    expect(res.asOfDate).toBe("2026-10-01");
    expect(res.qtyByProduct.get("a")).toBe(2);
  });

  it("is robust to an off-day gap (uses the latest available earlier count)", () => {
    const rows = [row("2026-09-28", "a", 4)];
    const res = pickLatestSnapshot(rows, "2026-10-01");
    expect(res.asOfDate).toBe("2026-09-28");
    expect(res.qtyByProduct.get("a")).toBe(4);
  });
});
