// Razorpay payment links on bills: the money logic around them.
//
//   * A link asks for THIS ORDER's unpaid amount -- bill total less what is
//     already allocated to the order (an advance, a website prepayment) --
//     never the customer's carried balance (admin, 2026-10-09).
//   * A link payment posts one ledger credit (mode upi, or other for cards/
//     netbanking), allocated to the order up to its unpaid amount; anything
//     beyond that stays unallocated as an advance (CLAUDE.md §3.7).
//   * A link still open on an order that gets fully paid some other way is
//     cancelled, so the customer can't pay twice.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, LedgerMode } from "@/lib/supabase/database.types";
import { roundToCents } from "./compute";
import { addPaymentLinkToMessage } from "./message";
import { cancelPaymentLink, createPaymentLink, paymentLinksEnabled } from "@/lib/razorpay/payment-links";

type Client = SupabaseClient<Database>;

export function unpaidForOrder(billTotal: number, allocatedToOrder: number): number {
  return Math.max(0, roundToCents(billTotal - allocatedToOrder));
}

export function ledgerModeForMethod(method: string | null | undefined): LedgerMode {
  return method === "upi" ? "upi" : "other";
}

// Splits a link payment: allocate to the order up to what it still owes;
// the remainder (an overpayment) stays as an advance.
export function planLinkPaymentAllocation(paid: number, orderUnpaid: number): number {
  return roundToCents(Math.min(paid, Math.max(0, orderUnpaid)));
}

async function allocatedToOrder(supabase: Client, orderId: string): Promise<number> {
  const { data } = await supabase.from("payment_allocations").select("amount").eq("order_id", orderId);
  return (data ?? []).reduce((sum, r) => sum + Number(r.amount), 0);
}

// For a bill generated without a link: makes one if the order still owes
// something and Razorpay is configured, writes it into the stored message.
export async function ensureBillPaymentLink(
  supabase: Client,
  p: {
    bill: { id: string; total: number; message_text: string | null; payment_link_id: string | null };
    orderId: string;
    customerId: string;
    customerName: string;
    phone: string | null;
    deliveryDate: string;
  },
): Promise<{ messageText: string; error?: string }> {
  const messageText = p.bill.message_text ?? "";
  if (p.bill.payment_link_id || !paymentLinksEnabled()) return { messageText };

  const amount = unpaidForOrder(Number(p.bill.total), await allocatedToOrder(supabase, p.orderId));
  if (amount <= 0) return { messageText };

  const created = await createPaymentLink({
    orderId: p.orderId,
    customerId: p.customerId,
    amount,
    customerName: p.customerName,
    phone: p.phone,
    description: `Good Fruit Club bill for ${p.deliveryDate}`,
  });
  if (!created.ok) return { messageText, error: created.error };

  const updated = addPaymentLinkToMessage(messageText, { url: created.link.shortUrl, amount });
  const { error } = await supabase
    .from("bills")
    .update({
      message_text: updated,
      payment_link_id: created.link.id,
      payment_link_url: created.link.shortUrl,
      payment_link_amount: amount,
      payment_link_status: "created",
    })
    .eq("id", p.bill.id);
  if (error) {
    await cancelPaymentLink(created.link.id);
    return { messageText, error: error.message };
  }
  return { messageText: updated };
}

export type LinkPaymentResult =
  | { status: "recorded"; orderId: string; amount: number; allocated: number }
  | { status: "duplicate" }
  | { status: "unknown_link" }
  | { status: "error"; error: string };

// Called by the webhook (service-role client: there is no signed-in user).
export async function recordLinkPayment(
  supabase: Client,
  p: { linkId: string; paymentId: string; amountPaise: number; method: string | null },
): Promise<LinkPaymentResult> {
  const { data: dup } = await supabase.from("ledger_entries").select("id").eq("external_ref", p.paymentId).maybeSingle();
  if (dup) return { status: "duplicate" };

  const { data: bill, error: billError } = await supabase
    .from("bills")
    .select("id, order_id, total, orders(customer_id)")
    .eq("payment_link_id", p.linkId)
    .maybeSingle();
  if (billError) return { status: "error", error: billError.message };
  if (!bill) return { status: "unknown_link" };
  const customerId = (bill.orders as unknown as { customer_id: string } | null)?.customer_id;
  if (!customerId) return { status: "error", error: "Bill has no customer" };

  const amount = roundToCents(p.amountPaise / 100);
  const allocate = planLinkPaymentAllocation(amount, unpaidForOrder(Number(bill.total), await allocatedToOrder(supabase, bill.order_id)));

  const { data: credit, error: creditError } = await supabase
    .from("ledger_entries")
    .insert({
      customer_id: customerId,
      entry_type: "credit",
      amount,
      mode: ledgerModeForMethod(p.method),
      order_id: null,
      note: `Razorpay link payment (${p.method ?? "online"}) · ${p.paymentId}`,
      entered_by: null,
      external_ref: p.paymentId,
    })
    .select("id")
    .single();
  if (creditError || !credit) {
    // A retried webhook racing the first one hits the unique external_ref.
    if (creditError?.code === "23505") return { status: "duplicate" };
    return { status: "error", error: creditError?.message ?? "Could not post the credit" };
  }

  if (allocate > 0) {
    const { error } = await supabase.from("payment_allocations").insert({ ledger_entry_id: credit.id, order_id: bill.order_id, amount: allocate });
    if (error) return { status: "error", error: error.message };
  }
  await supabase.from("bills").update({ payment_link_status: "paid" }).eq("id", bill.id);
  return { status: "recorded", orderId: bill.order_id, amount, allocated: allocate };
}

// After a manual payment: cancel any open link on an order that is now fully paid.
export async function cancelLinksForSettledOrders(supabase: Client, orderIds: string[]): Promise<void> {
  if (orderIds.length === 0 || !paymentLinksEnabled()) return;
  const { data: bills } = await supabase
    .from("bills")
    .select("id, order_id, total, payment_link_id")
    .in("order_id", orderIds)
    .eq("payment_link_status", "created");
  for (const b of bills ?? []) {
    if (!b.payment_link_id) continue;
    if (unpaidForOrder(Number(b.total), await allocatedToOrder(supabase, b.order_id)) > 0) continue;
    if (await cancelPaymentLink(b.payment_link_id)) {
      await supabase.from("bills").update({ payment_link_status: "cancelled" }).eq("id", b.id);
    }
  }
}
