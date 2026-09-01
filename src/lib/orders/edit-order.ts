// Post-save order edits (Manage Orders admin screen). Once a line has been
// resolved at packing, its ordered_qty is history -- correcting the qty must
// change actual_qty, since that's what billing reads (see
// src/lib/billing/resolve-line-prices.ts). A still-pending line hasn't been
// packed yet, so the correction is ordinary order-entry intent.

import type { LineStatus, OrderStatus } from "@/lib/supabase/database.types";

export function resolveQtyUpdateField(lineStatus: LineStatus): "ordered_qty" | "actual_qty" {
  return lineStatus === "packed" ? "actual_qty" : "ordered_qty";
}

// Once a delivery person is on the road with it (out_for_delivery and
// beyond), the order is no longer just data in this system -- edits stop
// there even if it hasn't been billed yet. dispatched is still fine: that
// only means it left Paschim Vihar for Gurgaon, not that a specific stop is
// underway.
const EDITABLE_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set(["recorded", "packed", "dispatched"]);

export function isOrderStatusEditable(status: OrderStatus): boolean {
  return EDITABLE_ORDER_STATUSES.has(status);
}

export interface NewOrderLineInput {
  orderId: string;
  orderStatus: OrderStatus;
  productId: string;
  qty: number;
  unit: string | null;
  lockedPricePerUnit: number | null;
}

export interface NewOrderLineRow {
  order_id: string;
  product_id: string;
  ordered_qty: number;
  ordered_unit: string | null;
  locked_price_per_unit: number | null;
  actual_qty: number | null;
  line_status: LineStatus;
  is_substitution: false;
}

// A line added while the order is still "recorded" hasn't reached packing
// yet, so it's a normal pending line. Added any later (packed and beyond),
// there's no pending-packing step left for it to go through, so it's
// inserted directly as billable -- priced "now" (CLAUDE.md §3.4 convention
// for anything not on the original order), not backdated to placed_at.
export function buildNewOrderLineRow(input: NewOrderLineInput): NewOrderLineRow {
  const alreadyPastRecorded = input.orderStatus !== "recorded";
  return {
    order_id: input.orderId,
    product_id: input.productId,
    ordered_qty: input.qty,
    ordered_unit: input.unit,
    locked_price_per_unit: input.lockedPricePerUnit,
    actual_qty: alreadyPastRecorded ? input.qty : null,
    line_status: alreadyPastRecorded ? "packed" : "pending",
    is_substitution: false,
  };
}
