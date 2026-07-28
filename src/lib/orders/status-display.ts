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
