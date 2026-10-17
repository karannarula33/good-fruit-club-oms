"use server";

// Admin edits to an order that has already been billed (CLAUDE.md §7, Manage
// Orders; rules in src/lib/billing/edit.ts). Every edit rebuilds the bill in
// place: total, previous balance, net due, the WhatsApp text, this order's
// ledger debit, its payment allocations and its Razorpay link.
//
// Bills, the ledger and allocations have no UPDATE/DELETE RLS policy (they
// are append-only for app users), so after the admin check the writes go
// through the service-role client. Every change is audited: qty and rate
// edits in quantity_overrides / price_overrides, the debit's note says it
// was edited.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { computeBillTotal, computeNetDue, roundLineAmount, roundToCents } from "@/lib/billing/compute";
import { buildBillMessage, type BillLineItem } from "@/lib/billing/message";
import { unpaidForOrder } from "@/lib/billing/payment-link";
import { cancelPaymentLink, createPaymentLink, paymentLinksEnabled } from "@/lib/razorpay/payment-links";
import { balanceExcludingOrderDebit, planAllocationTrim, validateBillLineEdit, type BillLineEdit } from "@/lib/billing/edit";

type Client = ReturnType<typeof createServiceRoleClient>;

export type BillEditResult =
  | { ok: true; total: number; messageText: string; customerPhone: string | null; paymentLinkError?: string }
  | { ok: false; error: string };

const EDIT_REASON = "Bill edited after it was generated";

async function billedOrder(supabase: Client, orderId: string) {
  const { data: order } = await supabase.from("orders").select("id, status").eq("id", orderId).single();
  if (!order) return { ok: false as const, error: "Order not found." };
  if (order.status === "cancelled") return { ok: false as const, error: "This order is cancelled." };
  const { data: bill } = await supabase.from("bills").select("id").eq("order_id", orderId).maybeSingle();
  if (!bill) return { ok: false as const, error: "This order isn't billed yet — edit it from the packing screen." };
  return { ok: true as const };
}

export async function editBilledLine(orderId: string, lineId: string, edit: BillLineEdit): Promise<BillEditResult> {
  const profile = await requireRole(["admin"]);
  const valid = validateBillLineEdit(edit);
  if (!valid.ok) return valid;
  const supabase = createServiceRoleClient();
  const guard = await billedOrder(supabase, orderId);
  if (!guard.ok) return guard;

  const { data: line } = await supabase
    .from("order_lines")
    .select("id, actual_qty, locked_price_per_unit, line_status")
    .eq("id", lineId)
    .eq("order_id", orderId)
    .single();
  if (!line || line.line_status !== "packed") return { ok: false, error: "That item isn't on the bill." };

  const update: { actual_qty?: number; locked_price_per_unit?: number } = {};
  if (edit.qty !== undefined && edit.qty !== Number(line.actual_qty)) {
    update.actual_qty = edit.qty;
    const { error } = await supabase.from("quantity_overrides").insert({
      order_line_id: lineId, previous_qty: line.actual_qty, new_qty: edit.qty, reason: EDIT_REASON, overridden_by: profile.id,
    });
    if (error) return { ok: false, error: error.message };
  }
  if (edit.price !== undefined && edit.price !== Number(line.locked_price_per_unit)) {
    update.locked_price_per_unit = edit.price;
    const { error } = await supabase.from("price_overrides").insert({
      order_line_id: lineId, previous_price: line.locked_price_per_unit, new_price: edit.price, reason: EDIT_REASON, overridden_by: profile.id,
    });
    if (error) return { ok: false, error: error.message };
  }
  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from("order_lines").update(update).eq("id", lineId);
    if (error) return { ok: false, error: error.message };
  }
  return rebuildBill(supabase, orderId);
}

// Removing an item from a billed order marks it unavailable (kept for the
// record, dropped from the bill), the same as at packing.
export async function removeBilledLine(orderId: string, lineId: string): Promise<BillEditResult> {
  await requireRole(["admin"]);
  const supabase = createServiceRoleClient();
  const guard = await billedOrder(supabase, orderId);
  if (!guard.ok) return guard;
  const { error } = await supabase
    .from("order_lines")
    .update({ line_status: "unavailable" })
    .eq("id", lineId)
    .eq("order_id", orderId);
  if (error) return { ok: false, error: error.message };
  return rebuildBill(supabase, orderId);
}

export async function addBilledLine(orderId: string, productId: string, qty: number, price: number): Promise<BillEditResult> {
  const profile = await requireRole(["admin"]);
  const valid = validateBillLineEdit({ qty, price });
  if (!valid.ok) return valid;
  const supabase = createServiceRoleClient();
  const guard = await billedOrder(supabase, orderId);
  if (!guard.ok) return guard;
  const { data: product } = await supabase.from("products").select("unit_label").eq("id", productId).single();
  if (!product) return { ok: false, error: "Product not found." };
  const { data: line, error } = await supabase
    .from("order_lines")
    .insert({
      order_id: orderId,
      product_id: productId,
      ordered_qty: qty,
      ordered_unit: product.unit_label,
      actual_qty: qty,
      locked_price_per_unit: price,
      line_status: "packed",
      parse_confidence: "clean",
      parse_note: EDIT_REASON,
    })
    .select("id")
    .single();
  if (error || !line) return { ok: false, error: error?.message ?? "Could not add the item." };
  // Audited like a rate edit, so the rate is never re-resolved from the list.
  await supabase.from("price_overrides").insert({
    order_line_id: line.id, previous_price: null, new_price: price, reason: EDIT_REASON, overridden_by: profile.id,
  });
  return rebuildBill(supabase, orderId);
}

// The current bill text, to send it again after an edit.
export async function getBillMessage(orderId: string): Promise<BillEditResult> {
  await requireRole(["admin"]);
  const supabase = createServiceRoleClient();
  const { data: bill } = await supabase.from("bills").select("total, message_text, orders(customers(phone))").eq("order_id", orderId).maybeSingle();
  if (!bill) return { ok: false, error: "This order isn't billed yet." };
  const phone = (bill.orders as unknown as { customers: { phone: string | null } | null } | null)?.customers?.phone ?? null;
  return { ok: true, total: Number(bill.total), messageText: bill.message_text ?? "", customerPhone: phone };
}

async function rebuildBill(supabase: Client, orderId: string): Promise<BillEditResult> {
  const { data: order } = await supabase.from("orders").select("id, customer_id, delivery_date").eq("id", orderId).single();
  if (!order) return { ok: false, error: "Order not found." };
  const { data: customer } = await supabase
    .from("customers")
    .select("display_name, phone, salutation")
    .eq("id", order.customer_id)
    .single();
  if (!customer) return { ok: false, error: "Customer not found." };
  const { data: bill } = await supabase
    .from("bills")
    .select("id, total, payment_link_id, payment_link_status")
    .eq("order_id", orderId)
    .single();
  if (!bill) return { ok: false, error: "Bill not found." };

  const { data: lineRows, error: linesError } = await supabase
    .from("order_lines")
    .select("id, actual_qty, locked_price_per_unit, products(name, unit_label)")
    .eq("order_id", orderId)
    .eq("line_status", "packed");
  if (linesError) return { ok: false, error: linesError.message };

  const { total: lineTotal, unpricedLineCount } = computeBillTotal(
    (lineRows ?? []).map((l) => ({ actualQty: Number(l.actual_qty ?? 0), lockedPricePerUnit: l.locked_price_per_unit })),
  );
  if (unpricedLineCount > 0) return { ok: false, error: `${unpricedLineCount} item(s) on this bill have no rate — set one first.` };
  const total = roundToCents(lineTotal);

  const { data: ledgerRows, error: ledgerError } = await supabase
    .from("ledger_entries")
    .select("id, entry_type, amount, order_id")
    .eq("customer_id", order.customer_id);
  if (ledgerError) return { ok: false, error: ledgerError.message };
  const prevBalance = balanceExcludingOrderDebit(
    (ledgerRows ?? []).map((r) => ({ entryType: r.entry_type, amount: Number(r.amount), orderId: r.order_id })),
    orderId,
  );
  const netDue = computeNetDue(total, prevBalance);

  // Allocations above the new total are trimmed, newest first; the freed
  // money stays on the account as an advance.
  const { data: allocRows, error: allocError } = await supabase
    .from("payment_allocations")
    .select("id, amount, ledger_entries(created_at)")
    .eq("order_id", orderId);
  if (allocError) return { ok: false, error: allocError.message };
  const allocations = (allocRows ?? []).map((a) => ({
    id: a.id,
    amount: Number(a.amount),
    createdAt: (a.ledger_entries as unknown as { created_at: string } | null)?.created_at ?? "",
  }));
  const trims = planAllocationTrim(allocations, total);
  for (const t of trims) {
    const { error } = t.amount > 0
      ? await supabase.from("payment_allocations").update({ amount: t.amount }).eq("id", t.id)
      : await supabase.from("payment_allocations").delete().eq("id", t.id);
    if (error) return { ok: false, error: error.message };
  }
  const trimmedById = new Map(trims.map((t) => [t.id, t.amount]));
  const allocated = roundToCents(allocations.reduce((sum, a) => sum + (trimmedById.get(a.id) ?? a.amount), 0));

  // The old link asked for the old amount: cancel it (unless it was paid) and
  // make a fresh one for what this order now owes.
  if (bill.payment_link_id && bill.payment_link_status === "created") await cancelPaymentLink(bill.payment_link_id);
  const keepPaidLink = bill.payment_link_status === "paid";
  const linkAmount = unpaidForOrder(total, allocated);
  let paymentLink: { id: string; url: string; amount: number } | null = null;
  let paymentLinkError: string | undefined;
  if (linkAmount > 0 && paymentLinksEnabled()) {
    const created = await createPaymentLink({
      orderId,
      customerId: order.customer_id,
      amount: linkAmount,
      customerName: customer.display_name,
      phone: customer.phone,
      description: `Good Fruit Club bill for ${order.delivery_date} (updated)`,
    });
    if (created.ok) paymentLink = { id: created.link.id, url: created.link.shortUrl, amount: linkAmount };
    else paymentLinkError = created.error;
  }

  const billLines: BillLineItem[] = (lineRows ?? []).map((l) => {
    const product = l.products as unknown as { name: string; unit_label: string | null } | null;
    const qty = Number(l.actual_qty);
    const rate = Number(l.locked_price_per_unit);
    return { productName: product?.name ?? "Item", actualQty: qty, unitLabel: product?.unit_label ?? null, ratePerUnit: rate, amount: roundLineAmount(qty, rate) };
  });
  const messageText = buildBillMessage({
    salutation: customer.salutation === "Sir" ? "Sir" : "Ma'am",
    deliveryDate: order.delivery_date,
    lines: billLines,
    total,
    prevBalance,
    netDue,
    paymentLink,
  });

  const { error: billError } = await supabase
    .from("bills")
    .update({
      total,
      prev_balance: prevBalance,
      net_due: netDue,
      message_text: messageText,
      ...(paymentLink
        ? { payment_link_id: paymentLink.id, payment_link_url: paymentLink.url, payment_link_amount: paymentLink.amount, payment_link_status: "created" }
        : keepPaidLink
          ? {}
          : { payment_link_status: bill.payment_link_id ? "cancelled" : null }),
    })
    .eq("id", bill.id);
  if (billError) {
    if (paymentLink) await cancelPaymentLink(paymentLink.id);
    return { ok: false, error: billError.message };
  }

  const { error: debitError } = await supabase
    .from("ledger_entries")
    .update({ amount: total, note: `Bill edited by admin (was ₹${Number(bill.total)})` })
    .eq("order_id", orderId)
    .eq("entry_type", "debit");
  if (debitError) return { ok: false, error: debitError.message };

  revalidatePath("/admin/manage-orders");
  revalidatePath("/admin/customers");
  return { ok: true, total, messageText, customerPhone: customer.phone, paymentLinkError };
}
