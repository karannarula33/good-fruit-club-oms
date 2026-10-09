"use server";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { loadPriceItemRecords, loadPriceTierRecords } from "@/lib/pricing/load";
import { resolveBillLinePrices } from "@/lib/billing/resolve-line-prices";
import { computeBillTotal, computeCustomerBalance, computeNetDue, roundLineAmount } from "@/lib/billing/compute";
import { buildBillMessage, type BillLineItem } from "@/lib/billing/message";
import { ensureBillPaymentLink, unpaidForOrder } from "@/lib/billing/payment-link";
import { cancelPaymentLink, createPaymentLink, paymentLinksEnabled } from "@/lib/razorpay/payment-links";
import { planAdvanceAllocation, type AdvanceCredit } from "@/lib/billing/allocate";
import { validatePriceOverride, validateQuantityOverride } from "@/lib/billing/override";
import { classifySalutation } from "@/lib/parser/classify-salutation";

export type GenerateBillResult =
  // paymentLinkError: the bill was made but its Razorpay link couldn't be;
  // reopening the bill tries again.
  | { ok: true; messageText: string; customerPhone: string | null; paymentLinkError?: string }
  | { ok: false; reason: "unpriced"; unpricedLineCount: number }
  | { ok: false; reason: "salutation_needed" }
  | { ok: false; reason: "error"; error: string };

// Admin-only: packing and billing are two separately-triggered steps
// (packing-screen.tsx) -- a packer marks an order packed, an admin
// separately reviews the priced line items and generates the bill.
export async function generateBill(orderId: string): Promise<GenerateBillResult> {
  const profile = await requireRole(["admin"]);
  const supabase = await createClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, delivery_date, customer_id")
    .eq("id", orderId)
    .single();
  if (orderError || !order) {
    return { ok: false, reason: "error", error: orderError?.message ?? "Order not found." };
  }

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("display_name, phone, salutation")
    .eq("id", order.customer_id)
    .single();
  if (customerError || !customer) {
    return { ok: false, reason: "error", error: customerError?.message ?? "Customer not found." };
  }

  // Idempotent: a bill already exists for this order (e.g. a retried
  // call) -- return it as-is rather than ever generating a second one.
  const { data: existingBill } = await supabase
    .from("bills")
    .select("id, total, message_text, payment_link_id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existingBill) {
    // A bill made before links existed (or whose link failed) gets one now,
    // if the order still has something unpaid.
    const linked = await ensureBillPaymentLink(supabase, {
      bill: existingBill,
      orderId,
      customerId: order.customer_id,
      customerName: customer.display_name,
      phone: customer.phone,
      deliveryDate: order.delivery_date,
    });
    return { ok: true, messageText: linked.messageText, customerPhone: customer.phone, paymentLinkError: linked.error };
  }

  // Classified once per customer and cached on customers.salutation --
  // never re-classified once set. A genuinely ambiguous name (business,
  // couple, initials) blocks billing until the admin picks Sir/Ma'am
  // manually (updateCustomerSalutation), same "never guess" guard as prices.
  let salutation = customer.salutation;
  if (!salutation) {
    const classified = await classifySalutation(customer.display_name);
    if (classified === "unknown") {
      return { ok: false, reason: "salutation_needed" };
    }
    salutation = classified;
    const { error: salutationError } = await supabase
      .from("customers")
      .update({ salutation })
      .eq("id", order.customer_id);
    if (salutationError) {
      return { ok: false, reason: "error", error: salutationError.message };
    }
  }

  const { data: lineRows, error: linesError } = await supabase
    .from("order_lines")
    .select("id, product_id, actual_qty, locked_price_per_unit, products(name, unit_label)")
    .eq("order_id", orderId)
    .eq("line_status", "packed");
  if (linesError) {
    return { ok: false, reason: "error", error: linesError.message };
  }

  // Packing is deliberately price-blind (src/lib/packing/finalize.ts), so
  // every line's price gets resolved right here, against whatever's active
  // at billing time using the actual packed qty -- this is what makes "the
  // latest configured price" always reflect at the billing step, per
  // CLAUDE.md §3.2's guard plus the admin's explicit override escape hatch.
  // A line the admin has already overridden (audited in price_overrides)
  // is left exactly as they set it and never silently re-resolved.
  const lineIds = (lineRows ?? []).map((line) => line.id);
  const [priceItems, tierItems, { data: overrideRows }] = await Promise.all([
    loadPriceItemRecords(supabase),
    loadPriceTierRecords(supabase),
    lineIds.length
      ? supabase.from("price_overrides").select("order_line_id").in("order_line_id", lineIds)
      : Promise.resolve({ data: [] }),
  ]);
  const overriddenLineIds = new Set((overrideRows ?? []).map((r) => r.order_line_id));
  const now = new Date();
  const resolvedPriceByLineId = resolveBillLinePrices(
    (lineRows ?? []).map((line) => ({
      id: line.id,
      productId: line.product_id,
      actualQty: line.actual_qty as number | null,
      lockedPricePerUnit: line.locked_price_per_unit,
    })),
    overriddenLineIds,
    priceItems,
    tierItems,
    now,
  );

  const toPersist = (lineRows ?? []).filter((line) => !overriddenLineIds.has(line.id));
  if (toPersist.length > 0) {
    const results = await Promise.all(
      toPersist.map((line) =>
        supabase
          .from("order_lines")
          .update({ locked_price_per_unit: resolvedPriceByLineId.get(line.id) ?? null })
          .eq("id", line.id),
      ),
    );
    const firstError = results.find((r) => r.error);
    if (firstError?.error) {
      return { ok: false, reason: "error", error: firstError.error.message };
    }
  }

  const effectivePriceForLine = (line: { id: string }) => resolvedPriceByLineId.get(line.id) ?? null;

  const billableLines = (lineRows ?? []).map((line) => ({
    actualQty: line.actual_qty as number,
    lockedPricePerUnit: effectivePriceForLine(line),
  }));

  const { total, unpricedLineCount } = computeBillTotal(billableLines);
  if (unpricedLineCount > 0) {
    return { ok: false, reason: "unpriced", unpricedLineCount };
  }

  const { data: ledgerRows, error: ledgerError } = await supabase
    .from("ledger_entries")
    .select("id, entry_type, amount, created_at")
    .eq("customer_id", order.customer_id);
  if (ledgerError) {
    return { ok: false, reason: "error", error: ledgerError.message };
  }
  const prevBalance = computeCustomerBalance(
    (ledgerRows ?? []).map((row) => ({ entryType: row.entry_type, amount: row.amount })),
  );
  const netDue = computeNetDue(total, prevBalance);

  const billLines: BillLineItem[] = (lineRows ?? []).map((line) => {
    const product = line.products as unknown as { name: string; unit_label: string | null } | null;
    const actualQty = line.actual_qty as number;
    const ratePerUnit = effectivePriceForLine(line) as number;
    return {
      productName: product?.name ?? "Item",
      actualQty,
      unitLabel: product?.unit_label ?? null,
      ratePerUnit,
      amount: roundLineAmount(actualQty, ratePerUnit),
    };
  });

  // CLAUDE.md §3.7: an existing advance auto-allocates, oldest-first, the
  // next time a bill finalizes -- purely additive bookkeeping for deriving
  // *this order's* payment status; it never touches total/prevBalance/
  // netDue above, which already account for every credit regardless of
  // allocation state. Planned here (written after the bill) because the
  // payment link only asks for what the advance doesn't cover.
  const creditRows = (ledgerRows ?? []).filter((row) => row.entry_type === "credit");
  let allocationPlan: ReturnType<typeof planAdvanceAllocation> = [];
  if (creditRows.length > 0) {
    const creditIds = creditRows.map((row) => row.id);
    const { data: allocRows, error: allocError } = await supabase
      .from("payment_allocations")
      .select("ledger_entry_id, amount")
      .in("ledger_entry_id", creditIds);
    if (allocError) {
      return { ok: false, reason: "error", error: allocError.message };
    }
    const allocatedByCredit = new Map<string, number>();
    for (const row of allocRows ?? []) {
      allocatedByCredit.set(row.ledger_entry_id, (allocatedByCredit.get(row.ledger_entry_id) ?? 0) + row.amount);
    }
    const advances: AdvanceCredit[] = creditRows.map((row) => ({
      ledgerEntryId: row.id,
      amount: row.amount,
      allocatedSoFar: allocatedByCredit.get(row.id) ?? 0,
      createdAt: new Date(row.created_at),
    }));
    allocationPlan = planAdvanceAllocation({ advances, billTotal: total });
  }

  // Razorpay link for this order's unpaid amount (admin, 2026-10-09: the
  // order only, never the carried balance). An order fully covered by an
  // advance -- e.g. prepaid on the website -- gets no link. A Razorpay
  // failure never blocks the bill; it goes out without a link.
  const linkAmount = unpaidForOrder(total, allocationPlan.reduce((sum, item) => sum + item.amount, 0));
  let paymentLink: { id: string; url: string; amount: number } | null = null;
  let paymentLinkError: string | undefined;
  if (linkAmount > 0 && paymentLinksEnabled()) {
    const created = await createPaymentLink({
      orderId,
      customerId: order.customer_id,
      amount: linkAmount,
      customerName: customer.display_name,
      phone: customer.phone,
      description: `Good Fruit Club bill for ${order.delivery_date}`,
    });
    if (created.ok) paymentLink = { id: created.link.id, url: created.link.shortUrl, amount: linkAmount };
    else paymentLinkError = created.error;
  }

  const messageText = buildBillMessage({
    salutation,
    deliveryDate: order.delivery_date,
    lines: billLines,
    total,
    prevBalance,
    netDue,
    paymentLink,
  });

  const { error: billError } = await supabase.from("bills").insert({
    order_id: orderId,
    total,
    prev_balance: prevBalance,
    net_due: netDue,
    message_text: messageText,
    finalized_at: new Date().toISOString(),
    finalized_by: profile.id,
    payment_link_id: paymentLink?.id ?? null,
    payment_link_url: paymentLink?.url ?? null,
    payment_link_amount: paymentLink?.amount ?? null,
    payment_link_status: paymentLink ? "created" : null,
  });
  if (billError) {
    if (paymentLink) await cancelPaymentLink(paymentLink.id);
    return { ok: false, reason: "error", error: billError.message };
  }

  const { error: debitError } = await supabase.from("ledger_entries").insert({
    customer_id: order.customer_id,
    entry_type: "debit",
    amount: total,
    order_id: orderId,
    entered_by: profile.id,
  });
  if (debitError) {
    return { ok: false, reason: "error", error: debitError.message };
  }

  if (allocationPlan.length > 0) {
    const { error: allocInsertError } = await supabase.from("payment_allocations").insert(
      allocationPlan.map((item) => ({
        ledger_entry_id: item.ledgerEntryId,
        order_id: orderId,
        amount: item.amount,
      })),
    );
    if (allocInsertError) {
      return { ok: false, reason: "error", error: allocInsertError.message };
    }
  }

  // No revalidatePath here on purpose -- see the matching note in
  // src/app/actions/packing.ts. The packer needs the "Send bill" button
  // to stay on screen until they explicitly tap "Done".
  return { ok: true, messageText, customerPhone: customer.phone, paymentLinkError };
}

export type OverrideLinePriceResult = { ok: true } | { ok: false; error: string };

// Admin-only, deliberate exception to CLAUDE.md §3.1's price-lock rule --
// see validatePriceOverride for the eligibility guards and the audit trail
// this writes to price_overrides (migration 0016).
export async function overrideLinePrice(
  orderLineId: string,
  newPrice: number,
  reason: string,
): Promise<OverrideLinePriceResult> {
  const profile = await requireRole(["admin"]);
  const supabase = await createClient();

  const { data: line, error: lineError } = await supabase
    .from("order_lines")
    .select("id, order_id, locked_price_per_unit, line_status, orders(status)")
    .eq("id", orderLineId)
    .single();
  if (lineError || !line) {
    return { ok: false, error: lineError?.message ?? "Line not found." };
  }
  const order = line.orders as unknown as { status: string } | null;

  const { data: existingBill } = await supabase
    .from("bills")
    .select("id")
    .eq("order_id", line.order_id)
    .maybeSingle();

  const validation = validatePriceOverride({
    newPrice,
    reason,
    orderStatus: order?.status ?? "",
    lineStatus: line.line_status,
    hasBill: existingBill != null,
  });
  if (!validation.ok) {
    return validation;
  }

  const { error: overrideError } = await supabase.from("price_overrides").insert({
    order_line_id: orderLineId,
    previous_price: line.locked_price_per_unit,
    new_price: newPrice,
    reason: reason.trim(),
    overridden_by: profile.id,
  });
  if (overrideError) {
    return { ok: false, error: overrideError.message };
  }

  const { error: updateError } = await supabase
    .from("order_lines")
    .update({ locked_price_per_unit: newPrice })
    .eq("id", orderLineId);
  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  // No revalidatePath here either -- same reasoning as finalizeOrder; the
  // packer/admin client calls router.refresh() itself after a successful
  // override so the price shown before "Generate Bill →" updates in place.
  return { ok: true };
}

export type OverrideLineQuantityResult = { ok: true } | { ok: false; error: string };

// Admin-only correction of a packer's actual_qty entry at the same
// billing-time review step as overrideLinePrice -- see
// validateQuantityOverride for the eligibility guards and the audit trail
// this writes to quantity_overrides (migration 0019). Deliberately does not
// touch locked_price_per_unit: a line whose price hasn't been separately
// overridden keeps resolving live off the current actual_qty (see
// resolveBillLinePrices), so a qty-only correction re-prices itself.
export async function overrideLineQuantity(
  orderLineId: string,
  newQty: number,
  reason: string,
): Promise<OverrideLineQuantityResult> {
  const profile = await requireRole(["admin"]);
  const supabase = await createClient();

  const { data: line, error: lineError } = await supabase
    .from("order_lines")
    .select("id, order_id, actual_qty, line_status, orders(status)")
    .eq("id", orderLineId)
    .single();
  if (lineError || !line) {
    return { ok: false, error: lineError?.message ?? "Line not found." };
  }
  const order = line.orders as unknown as { status: string } | null;

  const { data: existingBill } = await supabase
    .from("bills")
    .select("id")
    .eq("order_id", line.order_id)
    .maybeSingle();

  const validation = validateQuantityOverride({
    newQty,
    reason,
    orderStatus: order?.status ?? "",
    lineStatus: line.line_status,
    hasBill: existingBill != null,
  });
  if (!validation.ok) {
    return validation;
  }

  const { error: overrideError } = await supabase.from("quantity_overrides").insert({
    order_line_id: orderLineId,
    previous_qty: line.actual_qty,
    new_qty: newQty,
    reason: reason.trim(),
    overridden_by: profile.id,
  });
  if (overrideError) {
    return { ok: false, error: overrideError.message };
  }

  const { error: updateError } = await supabase
    .from("order_lines")
    .update({ actual_qty: newQty })
    .eq("id", orderLineId);
  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  return { ok: true };
}
