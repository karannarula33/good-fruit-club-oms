// Order discounts (admin, 2026-11-11): a flat rupee amount or a percentage
// off an order, set by the admin on Manage Orders with a reason (migration
// 0044). Applied to the bill's subtotal (items + gift packing):
//   total = subtotal - discount, never below ₹0.
// A percentage is rounded to the whole rupee (bill amounts are whole rupees,
// see roundLineAmount); a flat amount is capped at the subtotal.
// Tested in tests/billing/discount.test.ts.
import { roundToCents } from "./compute";
import type { DiscountType } from "@/lib/supabase/database.types";

export interface OrderDiscount {
  type: DiscountType;
  value: number;
}

export const MAX_FLAT_DISCOUNT = 100000;
export const MIN_DISCOUNT_REASON = 3;
export const MAX_DISCOUNT_REASON = 200;

export function toOrderDiscount(type: string | null, value: number | string | null): OrderDiscount | null {
  if ((type !== "amount" && type !== "percent") || value === null) return null;
  const v = Number(value);
  return Number.isFinite(v) && v > 0 ? { type, value: v } : null;
}

export function validateDiscount(
  d: { type: string; value: number; reason: string },
): { ok: true; discount: OrderDiscount; reason: string } | { ok: false; error: string } {
  if (d.type !== "amount" && d.type !== "percent") return { ok: false, error: "Pick ₹ or %." };
  if (!Number.isFinite(d.value) || d.value <= 0) return { ok: false, error: "Enter a discount greater than zero." };
  if (d.type === "percent" && d.value > 100) return { ok: false, error: "A percentage can't be more than 100." };
  if (d.type === "amount" && d.value > MAX_FLAT_DISCOUNT) return { ok: false, error: "That discount is too large." };
  const reason = String(d.reason ?? "").replace(/\s+/g, " ").trim();
  if (reason.length < MIN_DISCOUNT_REASON) return { ok: false, error: "Add a reason for the discount." };
  return { ok: true, discount: { type: d.type, value: roundToCents(d.value) }, reason: reason.slice(0, MAX_DISCOUNT_REASON) };
}

// Rupees taken off a bill whose subtotal is `subtotal`.
export function discountAmount(subtotal: number, discount: OrderDiscount | null): number {
  if (!discount || subtotal <= 0) return 0;
  const raw = discount.type === "percent" ? Math.round((subtotal * discount.value) / 100) : discount.value;
  return roundToCents(Math.min(Math.max(raw, 0), subtotal));
}

export function applyDiscount(subtotal: number, discount: OrderDiscount | null): { subtotal: number; discount: number; total: number } {
  const off = discountAmount(subtotal, discount);
  return { subtotal: roundToCents(subtotal), discount: off, total: roundToCents(subtotal - off) };
}

// "Discount (10%)" or "Discount" -- the bill line's label.
export function discountLabel(discount: OrderDiscount | null): string {
  if (discount?.type === "percent") return `Discount (${discount.value}%)`;
  return "Discount";
}

// Short form for lists: "10% off" / "₹200 off".
export function describeDiscount(discount: OrderDiscount | null): string {
  if (!discount) return "";
  return discount.type === "percent" ? `${discount.value}% off` : `₹${discount.value} off`;
}
