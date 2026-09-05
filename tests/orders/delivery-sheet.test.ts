import { describe, expect, it } from "vitest";
import { buildDeliverySheetZoneGroups, formatDeliveryDateHeader } from "@/lib/orders/delivery-sheet";

describe("formatDeliveryDateHeader", () => {
  it("formats with ordinal day and weekday, unaffected by server timezone", () => {
    expect(formatDeliveryDateHeader("2026-09-03")).toBe("3rd September (Thursday)");
  });

  it("handles the 11th/12th/13th exceptions to the ordinal rule", () => {
    expect(formatDeliveryDateHeader("2026-09-11")).toBe("11th September (Friday)");
    expect(formatDeliveryDateHeader("2026-09-21")).toBe("21st September (Monday)");
  });
});

describe("buildDeliverySheetZoneGroups", () => {
  const baseOrder = {
    address: "some address",
    phone: "9999999999",
    paymentMode: "online" as const,
    netDue: 100,
  };

  it("orders zones by the fixed route priority, skipping empty zones", () => {
    const groups = buildDeliverySheetZoneGroups(
      [
        { ...baseOrder, id: "a", createdAt: "2026-09-01T05:00:00Z", customerName: "A", zone: "Phase 3" },
        { ...baseOrder, id: "b", createdAt: "2026-09-01T04:00:00Z", customerName: "B", zone: "DLF Phase 2" },
        { ...baseOrder, id: "c", createdAt: "2026-09-01T06:00:00Z", customerName: "C", zone: "Sushant Lok" },
      ],
      [],
      [],
    );
    expect(groups.map((g) => g.zone)).toEqual(["DLF Phase 2", "Sushant Lok", "Phase 3"]);
  });

  it("numbers orders by original entry order, stable across zone sections", () => {
    const groups = buildDeliverySheetZoneGroups(
      [
        { ...baseOrder, id: "a", createdAt: "2026-09-01T09:00:00Z", customerName: "A", zone: "Phase 3" },
        { ...baseOrder, id: "b", createdAt: "2026-09-01T08:00:00Z", customerName: "B", zone: "DLF Phase 2" },
      ],
      [],
      [],
    );
    const phase3Row = groups.find((g) => g.zone === "Phase 3")!.rows[0];
    const phase2Row = groups.find((g) => g.zone === "DLF Phase 2")!.rows[0];
    expect(phase2Row.orderNumber).toBe(1);
    expect(phase3Row.orderNumber).toBe(2);
  });

  it("shows an amount only for COD orders, never for online-pay orders", () => {
    const groups = buildDeliverySheetZoneGroups(
      [
        { ...baseOrder, id: "a", createdAt: "2026-09-01T05:00:00Z", customerName: "Cash Customer", zone: "Phase 3", paymentMode: "cod", netDue: 1250 },
        { ...baseOrder, id: "b", createdAt: "2026-09-01T06:00:00Z", customerName: "Online Customer", zone: "Phase 3", paymentMode: "online", netDue: 750 },
      ],
      [],
      [],
    );
    const rows = groups.find((g) => g.zone === "Phase 3")!.rows;
    expect(rows.find((r) => r.customerName === "Cash Customer")).toMatchObject({ isCod: true, amount: 1250 });
    expect(rows.find((r) => r.customerName === "Online Customer")).toMatchObject({ isCod: false, amount: null });
  });

  it("renders packaging as compact codes, grouped by type", () => {
    const groups = buildDeliverySheetZoneGroups(
      [{ ...baseOrder, id: "a", createdAt: "2026-09-01T05:00:00Z", customerName: "A", zone: "Phase 3" }],
      [
        { order_id: "a", package_id: "pkg-1" },
        { order_id: "a", package_id: "pkg-2" },
      ],
      [
        { id: "pkg-1", order_id: "a", packaging_type: "big_box" },
        { id: "pkg-2", order_id: "a", packaging_type: "small_packet" },
      ],
    );
    expect(groups[0].rows[0].packagingCodes).toBe("B - 1, SP - 1");
  });
});
