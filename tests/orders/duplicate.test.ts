import { describe, expect, it } from "vitest";
import { duplicateLineRows } from "@/lib/orders/duplicate";

const line = (o: Partial<Parameters<typeof duplicateLineRows>[1][number]> = {}) => ({
  product_id: "p1", ordered_qty: 2, ordered_unit: "kg", locked_price_per_unit: 300,
  is_gift_box: false, is_substitution: false, ...o,
});

describe("duplicateLineRows", () => {
  it("copies what was ordered as fresh to-pack lines", () => {
    const [row] = duplicateLineRows("new", [line({ is_gift_box: true })]);
    expect(row).toMatchObject({
      order_id: "new", product_id: "p1", ordered_qty: 2, ordered_unit: "kg", locked_price_per_unit: 300,
      is_gift_box: true, line_status: "pending", parse_confidence: "clean",
    });
    expect(row).not.toHaveProperty("actual_qty");
    expect(row).not.toHaveProperty("billed_qty");
  });
  it("skips substitutes and empty lines, keeps items that were unavailable", () => {
    const rows = duplicateLineRows("new", [
      line(),
      line({ product_id: "p2", is_substitution: true }),
      line({ product_id: null }),
      line({ product_id: "p3", ordered_qty: 0 }),
      line({ product_id: "p4" }), // was marked unavailable on the original; still ordered
    ]);
    expect(rows.map((r) => r.product_id)).toEqual(["p1", "p4"]);
  });
  it("flags an item with no price", () => {
    expect(duplicateLineRows("new", [line({ locked_price_per_unit: null })])[0].parse_confidence).toBe("flagged");
  });
});
