import { describe, expect, it } from "vitest";
import { buildNewOrderLineRow, isOrderStatusEditable, resolveQtyUpdateField } from "@/lib/orders/edit-order";

describe("isOrderStatusEditable", () => {
  it.each(["recorded", "packed", "dispatched"] as const)("allows editing while %s", (status) => {
    expect(isOrderStatusEditable(status)).toBe(true);
  });

  it.each(["out_for_delivery", "delivered", "undelivered", "cancelled"] as const)(
    "blocks editing once %s",
    (status) => {
      expect(isOrderStatusEditable(status)).toBe(false);
    },
  );
});

describe("resolveQtyUpdateField", () => {
  it("targets actual_qty once a line has been packed", () => {
    expect(resolveQtyUpdateField("packed")).toBe("actual_qty");
  });

  it("targets ordered_qty for a still-pending line", () => {
    expect(resolveQtyUpdateField("pending")).toBe("ordered_qty");
  });

  it("targets ordered_qty for an unavailable line (reviving it is out of scope)", () => {
    expect(resolveQtyUpdateField("unavailable")).toBe("ordered_qty");
  });
});

describe("buildNewOrderLineRow", () => {
  const base = {
    orderId: "order-1",
    productId: "product-1",
    qty: 2.5,
    unit: "kg",
    lockedPricePerUnit: 120,
  };

  it("inserts a normal pending line when the order hasn't reached packing yet", () => {
    const row = buildNewOrderLineRow({ ...base, orderStatus: "recorded" });
    expect(row).toEqual({
      order_id: "order-1",
      product_id: "product-1",
      ordered_qty: 2.5,
      ordered_unit: "kg",
      locked_price_per_unit: 120,
      actual_qty: null,
      line_status: "pending",
      is_substitution: false,
    });
  });

  it.each(["packed", "dispatched", "out_for_delivery", "delivered", "undelivered", "cancelled"] as const)(
    "inserts a directly-billable line when the order is already %s",
    (orderStatus) => {
      const row = buildNewOrderLineRow({ ...base, orderStatus });
      expect(row.actual_qty).toBe(2.5);
      expect(row.line_status).toBe("packed");
      expect(row.ordered_qty).toBe(2.5);
    },
  );

  it("never marks an admin-added line as a substitution", () => {
    expect(buildNewOrderLineRow({ ...base, orderStatus: "packed" }).is_substitution).toBe(false);
  });

  it("passes through a null resolved price rather than defaulting it", () => {
    const row = buildNewOrderLineRow({ ...base, orderStatus: "recorded", lockedPricePerUnit: null });
    expect(row.locked_price_per_unit).toBeNull();
  });
});
