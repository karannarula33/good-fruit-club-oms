// A website order's delivery fee (orders.delivery_charge, migration 0045) is
// billed as its own "Delivery" line, in the total, net due and ledger debit
// (admin, 2026-11-11). Orders entered in the OMS have none.
import type { BillLineItem } from "@/lib/billing/message";

export function deliveryBillLine(charge: number): BillLineItem | null {
  if (!(charge > 0)) return null;
  return { productName: "Delivery", actualQty: 1, unitLabel: null, ratePerUnit: charge, amount: charge };
}
