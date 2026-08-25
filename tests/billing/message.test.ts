import { describe, expect, it } from "vitest";
import { buildBillMessage, type BillLineItem } from "@/lib/billing/message";

const lines: BillLineItem[] = [
  { productName: "Chausa Mango", actualQty: 2, unitLabel: "kg", ratePerUnit: 295, amount: 590 },
  { productName: "Afghan Cherry", actualQty: 1, unitLabel: "Box", ratePerUnit: 750, amount: 750 },
];

describe("buildBillMessage", () => {
  it("includes the delivery date and every line with its rate and amount", () => {
    const message = buildBillMessage({
      salutation: "Ma'am",
      deliveryDate: "2026-07-27",
      lines,
      total: 1340,
      prevBalance: 0,
      netDue: 1340,
    });
    expect(message).toContain("27 Jul 2026");
    expect(message).toContain("2 kg Chausa Mango @ ₹295 = ₹590");
    expect(message).toContain("1 Box Afghan Cherry @ ₹750 = ₹750");
    expect(message).toContain("Order total: ₹1,340");
    expect(message).toContain("Net amount due: ₹1,340");
  });

  it("includes the UPI ID and the exact sign-off", () => {
    const message = buildBillMessage({
      salutation: "Ma'am",
      deliveryDate: "2026-07-27",
      lines,
      total: 1340,
      prevBalance: 0,
      netDue: 1340,
    });
    expect(message).toContain("karannarula20@okhdfcbank");
    expect(message).toContain("– Good Fruit Club");
  });

  it("labels a positive previous balance as 'Previous balance'", () => {
    const message = buildBillMessage({
      salutation: "Ma'am",
      deliveryDate: "2026-07-27",
      lines,
      total: 1340,
      prevBalance: 500,
      netDue: 1840,
    });
    expect(message).toContain("Previous balance: ₹500");
    expect(message).not.toContain("Advance:");
  });

  it("labels a negative previous balance as 'Advance' and shows the absolute amount", () => {
    const message = buildBillMessage({
      salutation: "Ma'am",
      deliveryDate: "2026-07-27",
      lines,
      total: 1340,
      prevBalance: -300,
      netDue: 1040,
    });
    expect(message).toContain("Advance: ₹300");
    expect(message).not.toContain("Previous balance:");
  });

  it("always shows the carried balance line, even when zero", () => {
    const message = buildBillMessage({
      salutation: "Ma'am",
      deliveryDate: "2026-07-27",
      lines,
      total: 1340,
      prevBalance: 0,
      netDue: 1340,
    });
    expect(message).toContain("Previous balance: ₹0");
  });

  it("shows a placeholder when no lines were billable", () => {
    const message = buildBillMessage({
      salutation: "Ma'am",
      deliveryDate: "2026-07-27",
      lines: [],
      total: 0,
      prevBalance: 0,
      netDue: 0,
    });
    expect(message).toContain("No items packed");
  });

  it("greets with the salutation only (no customer name) and signs off with the exact Good Fruit Club text", () => {
    const message = buildBillMessage({
      salutation: "Sir",
      deliveryDate: "2026-07-27",
      lines,
      total: 1340,
      prevBalance: 0,
      netDue: 1340,
    });
    const [greeting] = message.split("\n");
    expect(greeting).toBe("Hello Sir,");
    expect(message.trim().endsWith("– Good Fruit Club")).toBe(true);
  });

  it("greets with Ma'am when the salutation is Ma'am", () => {
    const message = buildBillMessage({
      salutation: "Ma'am",
      deliveryDate: "2026-07-27",
      lines,
      total: 1340,
      prevBalance: 0,
      netDue: 1340,
    });
    const [greeting] = message.split("\n");
    expect(greeting).toBe("Hello Ma'am,");
  });
});
