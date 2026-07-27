"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { istWallClockToUtc } from "@/lib/time/ist";
import { loadCatalogEntries } from "@/lib/catalog/load";
import { loadPriceItemRecords } from "@/lib/pricing/load";
import { resolvePriceForProduct } from "@/lib/pricing/resolve";
import { deriveDeliveryDate } from "@/lib/orders/delivery-date";
import { deriveZoneFromAddress } from "@/lib/customers/zone";
import {
  parseOrderPaste,
  type CustomerEntry,
  type ParsedOrderCustomer,
  type ParsedOrderLine,
} from "@/lib/parser/parse-order";

export interface DraftLine extends ParsedOrderLine {
  resolvedPrice: number | null;
}

export interface OrderDraft {
  customer: ParsedOrderCustomer;
  deliveryDate: string;
  lines: DraftLine[];
  notes: string;
}

async function loadCustomers(supabase: Awaited<ReturnType<typeof createClient>>): Promise<CustomerEntry[]> {
  const { data, error } = await supabase.from("customers").select("id, display_name, phone, address");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.display_name,
    phone: row.phone,
    address: row.address,
  }));
}

export async function parseOrderDraft(
  rawText: string,
  placedAtIst: string,
): Promise<{ ok: true; draft: OrderDraft } | { ok: false; error: string }> {
  await requireRole(["admin"]);

  if (!rawText.trim()) {
    return { ok: false, error: "Paste an order first." };
  }

  try {
    const supabase = await createClient();
    const [catalog, customers, priceItems] = await Promise.all([
      loadCatalogEntries(supabase),
      loadCustomers(supabase),
      loadPriceItemRecords(supabase),
    ]);

    const parsed = await parseOrderPaste(rawText, catalog, customers);
    const placedAtUtc = istWallClockToUtc(placedAtIst);

    const lines: DraftLine[] = parsed.lines.map((line) => ({
      ...line,
      resolvedPrice: line.productId
        ? (resolvePriceForProduct(priceItems, line.productId, placedAtUtc)?.pricePerUnit ?? null)
        : null,
    }));

    return {
      ok: true,
      draft: {
        customer: parsed.customer,
        deliveryDate: deriveDeliveryDate(placedAtUtc),
        lines,
        notes: parsed.notes,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to parse order." };
  }
}

export interface SaveOrderLine {
  productId: string;
  rawText: string;
  orderedQty: number;
  orderedUnit: string | null;
  confidence: "clean" | "flagged";
  parseNote: string | null;
}

export interface SaveOrderInput {
  customer:
    | { kind: "existing"; customerId: string }
    | { kind: "new"; displayName: string; phone: string | null; address: string };
  placedAtIst: string;
  deliveryDate: string;
  notes: string | null;
  rawText: string;
  lines: SaveOrderLine[];
  newAliases: { productId: string; alias: string }[];
}

export async function saveOrder(
  input: SaveOrderInput,
): Promise<{ ok: true; orderId: string } | { ok: false; error: string }> {
  const profile = await requireRole(["admin"]);

  if (input.lines.length === 0) {
    return { ok: false, error: "No line items to save." };
  }
  for (const line of input.lines) {
    if (!line.productId || !Number.isFinite(line.orderedQty) || line.orderedQty <= 0) {
      return { ok: false, error: "Every line needs a product and a quantity greater than zero." };
    }
  }

  const supabase = await createClient();
  const placedAtUtc = istWallClockToUtc(input.placedAtIst);

  let customerId: string;
  if (input.customer.kind === "existing") {
    customerId = input.customer.customerId;
  } else {
    const zone = deriveZoneFromAddress(input.customer.address);
    const { data: newCustomer, error: customerError } = await supabase
      .from("customers")
      .insert({
        display_name: input.customer.displayName,
        phone: input.customer.phone,
        address: input.customer.address,
        zone,
      })
      .select("id")
      .single();
    if (customerError || !newCustomer) {
      return { ok: false, error: customerError?.message ?? "Failed to create customer." };
    }
    customerId = newCustomer.id;
  }

  // Merge rule (CLAUDE.md §3.9): a same-customer paste for the same
  // delivery date appends to the existing open order rather than creating
  // a duplicate. "Open" = not yet packed -- only status 'recorded' merges.
  const { data: existingOrder, error: existingOrderError } = await supabase
    .from("orders")
    .select("id, placed_at, raw_paste, notes")
    .eq("customer_id", customerId)
    .eq("delivery_date", input.deliveryDate)
    .eq("status", "recorded")
    .limit(1)
    .maybeSingle();
  if (existingOrderError) {
    return { ok: false, error: existingOrderError.message };
  }

  let orderId: string;
  let orderPlacedAtUtc: Date;

  if (existingOrder) {
    orderId = existingOrder.id;
    orderPlacedAtUtc = new Date(existingOrder.placed_at);

    const mergedRawPaste = existingOrder.raw_paste
      ? `${existingOrder.raw_paste}\n\n---\n\n${input.rawText}`
      : input.rawText;
    const mergedNotes = [existingOrder.notes, input.notes].filter(Boolean).join("\n\n---\n\n") || null;

    const { error: updateError } = await supabase
      .from("orders")
      .update({ raw_paste: mergedRawPaste, notes: mergedNotes })
      .eq("id", orderId);
    if (updateError) {
      return { ok: false, error: updateError.message };
    }
  } else {
    orderPlacedAtUtc = placedAtUtc;
    const { data: newOrder, error: orderError } = await supabase
      .from("orders")
      .insert({
        customer_id: customerId,
        placed_at: placedAtUtc.toISOString(),
        delivery_date: input.deliveryDate,
        status: "recorded",
        raw_paste: input.rawText,
        notes: input.notes,
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (orderError || !newOrder) {
      return { ok: false, error: orderError?.message ?? "Failed to create order." };
    }
    orderId = newOrder.id;
  }

  // Price resolution always uses the ORDER's placed_at (confirmed with the
  // user) -- even lines added later via a merge lock to the price version
  // active when the order was first created, not the merge moment.
  const priceItems = await loadPriceItemRecords(supabase);

  const orderLineRows = input.lines.map((line) => ({
    order_id: orderId,
    product_id: line.productId,
    ordered_qty: line.orderedQty,
    ordered_unit: line.orderedUnit,
    locked_price_per_unit: resolvePriceForProduct(priceItems, line.productId, orderPlacedAtUtc)?.pricePerUnit ?? null,
    parse_confidence: line.confidence,
    parse_note: line.parseNote,
  }));

  const { error: linesError } = await supabase.from("order_lines").insert(orderLineRows);
  if (linesError) {
    return { ok: false, error: linesError.message };
  }

  if (input.newAliases.length > 0) {
    const { error: aliasError } = await supabase
      .from("product_aliases")
      .insert(input.newAliases.map((alias) => ({ product_id: alias.productId, alias: alias.alias })));
    // Aliases are a convenience, not critical to the order itself -- don't
    // fail the whole save over a duplicate/racing alias insert.
    if (aliasError) {
      console.error("Failed to save new product aliases:", aliasError.message);
    }
  }

  revalidatePath("/admin/orders");
  return { ok: true, orderId };
}
