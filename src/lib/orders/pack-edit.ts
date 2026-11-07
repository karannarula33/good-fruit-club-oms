// Rules for changing an order from the packing screen before it's packed
// (admin, 2026-11-07: packers Kunal and Ravi). Only a 'recorded' order with
// no bill can change; only its still-pending items can be edited or removed;
// the last item can't be removed (cancel the order instead); cancelling needs
// a reason. Actions: src/app/actions/pack-edit.ts.
import type { LineStatus, OrderStatus } from "@/lib/supabase/database.types";

export const MIN_CANCEL_REASON = 3;
export const MAX_CANCEL_REASON = 300;

export function toPackGuard(status: OrderStatus, hasBill: boolean): { ok: true } | { ok: false; error: string } {
  if (hasBill) return { ok: false, error: "This order is already billed." };
  if (status !== "recorded") return { ok: false, error: "Only an order that's still to be packed can be changed here." };
  return { ok: true };
}

export function lineEditGuard(lineStatus: LineStatus): { ok: true } | { ok: false; error: string } {
  return lineStatus === "pending" ? { ok: true } : { ok: false, error: "That item has already been packed." };
}

export function removeLineGuard(remainingLines: number): { ok: true } | { ok: false; error: string } {
  return remainingLines > 0
    ? { ok: true }
    : { ok: false, error: "That's the only item on the order — cancel the order instead." };
}

export function cleanCancelReason(reason: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const r = String(reason ?? "").replace(/\s+/g, " ").trim();
  if (r.length < MIN_CANCEL_REASON) return { ok: false, error: "Say why the order is being cancelled." };
  return { ok: true, reason: r.slice(0, MAX_CANCEL_REASON) };
}

export function validQty(qty: number): boolean {
  return Number.isFinite(qty) && qty > 0 && qty < 1000;
}
