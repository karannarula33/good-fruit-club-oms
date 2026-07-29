import type { CSSProperties } from "react";
import type { OrderStatus } from "@/lib/supabase/database.types";
import type { BadgeTone } from "@/components/ui/badge";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  recorded: "Recorded",
  packed: "Packed",
  dispatched: "Dispatched",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const ORDER_STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  recorded: "neutral",
  packed: "warning",
  dispatched: "info",
  out_for_delivery: "brand",
  delivered: "success",
  cancelled: "danger",
};

export const ORDER_STATUS_ORDER: OrderStatus[] = [
  "recorded",
  "packed",
  "dispatched",
  "out_for_delivery",
  "delivered",
  "cancelled",
];

// "billed" isn't a stored orders.status value -- it's derived (packed AND
// a bills row exists), same as payment status is already derived rather
// than stored. Colors are the design handoff's exact per-status hex table.
export type DisplayStatus = OrderStatus | "billed";

export const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
  recorded: "To Pack",
  packed: "Packed",
  billed: "Billed",
  dispatched: "Dispatched",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Dropped",
};

export const DISPLAY_STATUS_COLORS: Record<DisplayStatus, { bg: string; fg: string }> = {
  recorded: { bg: "#F1F1EE", fg: "#5b5e66" },
  packed: { bg: "#DCEBFB", fg: "#2A6FB3" },
  billed: { bg: "#FFF1DC", fg: "#B35C1E" },
  dispatched: { bg: "#EDE3F8", fg: "#7C5AA0" },
  out_for_delivery: { bg: "#FFE4BE", fg: "#B35C1E" },
  delivered: { bg: "#E4F5EA", fg: "#2E9E5B" },
  cancelled: { bg: "#FBE7E1", fg: "#B3432B" },
};

export function deriveDisplayStatus(status: OrderStatus, hasBill: boolean): DisplayStatus {
  return status === "packed" && hasBill ? "billed" : status;
}

// Convenience for <Badge style={...}> callers -- DISPLAY_STATUS_COLORS
// stays {bg,fg} as the source-of-truth shape (matches how the design
// handoff documents it), this just maps to CSS property names.
export function displayStatusChipStyle(status: DisplayStatus): CSSProperties {
  const { bg, fg } = DISPLAY_STATUS_COLORS[status];
  return { background: bg, color: fg };
}
