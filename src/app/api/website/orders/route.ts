// Website orders straight to packing (admin, 2026-11-11). goodfruit.club POSTs
// each confirmed order here -- cash on delivery as soon as it's placed, online
// orders once Razorpay confirms payment -- and it becomes a normal "To pack"
// order, with no paste. Rules: src/lib/website/ingest.ts; schema: 0045.
//
// Auth: Authorization: Bearer $WEBSITE_ORDERS_SECRET (same value set on the
// site). Runs with the service role. Idempotent on the site order number: a
// repeat call returns the order already made.
//
// Body: { order_no, placed_at, payment_mode: "COD"|"ONLINE", payment_status,
//   customer: { name, phone, address, pincode, email },
//   lines: [{ name, qty, unit, price_per_unit }], delivery_fee, total }

import { after, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { deriveDeliveryDate } from "@/lib/orders/delivery-date";
import { deriveZoneFromAddress } from "@/lib/customers/zone";
import { fillCustomerAreas } from "@/lib/customers/fill-areas";
import { parseWebsiteOrder, phoneKey, planLines, websiteOrderText, type CatalogProduct } from "@/lib/website/ingest";

export const maxDuration = 30;

type Db = ReturnType<typeof createServiceRoleClient>;

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

// Already here: sent before, or pasted by hand with its site number before
// orders came over automatically (never make it twice).
async function existingOrder(db: Db, orderNo: string) {
  const { data } = await db.from("orders").select("id, delivery_date").eq("external_ref", orderNo).maybeSingle();
  if (data) return data;
  const { data: pasted } = await db
    .from("orders")
    .select("id, delivery_date")
    .filter("raw_paste", "imatch", `${orderNo}([^0-9]|$)`)
    .neq("status", "cancelled")
    .limit(1)
    .maybeSingle();
  return pasted;
}

async function findOrCreateCustomer(db: Db, c: { name: string; phone: string; address: string; pincode: string | null }) {
  const key = phoneKey(c.phone)!;
  let match: { id: string } | undefined;
  for (let from = 0; !match; from += 1000) {
    const { data: page, error } = await db
      .from("customers")
      .select("id, phone")
      .not("phone", "is", null)
      .order("created_at")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    match = (page ?? []).find((row) => phoneKey(row.phone) === key);
    if ((page ?? []).length < 1000) break;
  }
  if (match) return { id: match.id, created: false };
  const address = c.pincode && !c.address.includes(c.pincode) ? `${c.address}, ${c.pincode}` : c.address;
  const { data: created, error: insertError } = await db
    .from("customers")
    .insert({ display_name: c.name, phone: `+91${key}`, address, zone: deriveZoneFromAddress(address) })
    .select("id")
    .single();
  if (insertError || !created) throw new Error(insertError?.message ?? "Could not create the customer");
  return { id: created.id, created: true };
}

export async function POST(request: Request) {
  const secret = process.env.WEBSITE_ORDERS_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid JSON");
  }
  const parsed = parseWebsiteOrder(body);
  if (!parsed.ok) return fail(parsed.error);
  const o = parsed.order;
  const db = createServiceRoleClient();

  const already = await existingOrder(db, o.orderNo);
  if (already) return NextResponse.json({ ok: true, order_id: already.id, delivery_date: already.delivery_date, deduped: true });

  let customer: { id: string; created: boolean };
  try {
    customer = await findOrCreateCustomer(db, o.customer);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Customer failed", 500);
  }

  // Items: matched by name or alias to the OMS catalog. An item the OMS
  // doesn't have yet is added to the catalog (the site's catalog is the
  // source of truth for what's sold there) and flagged for a look.
  // Inactive products count too (a seasonal item switched off in the OMS is
  // still that item); active ones are matched first.
  const [{ data: products, error: productsError }, { data: aliases }] = await Promise.all([
    db.from("products").select("id, name, unit_label, active"),
    db.from("product_aliases").select("product_id, alias"),
  ]);
  if (productsError) return fail(productsError.message, 500);
  const catalog: CatalogProduct[] = [...(products ?? [])]
    .sort((a, b) => Number(b.active) - Number(a.active))
    .map((p) => ({
      id: p.id,
      name: p.name,
      unitLabel: p.unit_label,
      aliases: (aliases ?? []).filter((a) => a.product_id === p.id).map((a) => a.alias),
    }));
  const planned = planLines(o.lines, catalog);
  for (const line of planned) {
    if (line.productId) continue;
    const unit = line.orderedUnit ?? "piece";
    const { data: product, error } = await db
      .from("products")
      .insert({ name: line.siteName, unit_type: unit.toLowerCase() === "kg" ? "weight" : "count", unit_label: unit, active: true })
      .select("id")
      .single();
    if (error || !product) return fail(`Could not add ${line.siteName} to the catalog: ${error?.message}`, 500);
    line.productId = product.id;
    line.note = `New product added from the website: ${line.siteName} (per ${unit}) — check its details on Prices`;
  }

  const deliveryDate = deriveDeliveryDate(o.placedAt);
  const { data: order, error: orderError } = await db
    .from("orders")
    .insert({
      customer_id: customer.id,
      placed_at: o.placedAt.toISOString(),
      delivery_date: deliveryDate,
      status: "recorded",
      source: "website",
      external_ref: o.orderNo,
      delivery_charge: o.deliveryFee,
      prepaid_amount: o.paid ? o.total : null,
      raw_paste: websiteOrderText(o),
      created_by: null,
    })
    .select("id")
    .single();
  if (orderError || !order) {
    // Lost a race with a repeat call (unique order number): return that one.
    const raced = await existingOrder(db, o.orderNo);
    if (raced) return NextResponse.json({ ok: true, order_id: raced.id, delivery_date: raced.delivery_date, deduped: true });
    return fail(orderError?.message ?? "Could not create the order", 500);
  }

  const undo = async () => {
    const { data: ids } = await db.from("order_lines").select("id").eq("order_id", order.id);
    if (ids?.length) await db.from("price_overrides").delete().in("order_line_id", ids.map((r) => r.id));
    await db.from("order_lines").delete().eq("order_id", order.id);
    await db.from("orders").delete().eq("id", order.id);
  };

  const { data: lineRows, error: linesError } = await db
    .from("order_lines")
    .insert(
      planned.map((l) => ({
        order_id: order.id,
        product_id: l.productId,
        ordered_qty: l.orderedQty,
        ordered_unit: l.orderedUnit,
        locked_price_per_unit: l.lockedPrice,
        line_status: "pending" as const,
        parse_confidence: l.flagged || l.note ? ("flagged" as const) : ("clean" as const),
        parse_note: l.note,
      })),
    )
    .select("id");
  if (linesError || !lineRows || lineRows.length !== planned.length) {
    await undo();
    return fail(linesError?.message ?? "Could not add the items", 500);
  }

  // Keep the site price at billing: billing re-prices every line from the
  // OMS list except lines with a price override.
  const overrides = planned
    .map((l, i) => ({ l, id: lineRows[i].id }))
    .filter(({ l }) => l.keepSitePrice && l.lockedPrice !== null)
    .map(({ l, id }) => ({ order_line_id: id, previous_price: null, new_price: l.lockedPrice!, reason: `Website price (${o.orderNo})`, overridden_by: null }));
  if (overrides.length) {
    const { error } = await db.from("price_overrides").insert(overrides);
    if (error) {
      await undo();
      return fail(error.message, 500);
    }
  }

  // Paid online: post the payment as a credit for this order (its bill uses
  // it first; see src/app/actions/bills.ts).
  if (o.paid && o.total > 0) {
    const { data: credit, error } = await db
      .from("ledger_entries")
      .insert({
        customer_id: customer.id,
        entry_type: "credit",
        amount: o.total,
        mode: "other",
        order_id: null,
        note: `Paid online on the website (${o.orderNo})`,
        entered_by: null,
        external_ref: `website:${o.orderNo}`,
      })
      .select("id")
      .single();
    if (error || !credit) {
      await undo();
      return fail(error?.message ?? "Could not record the payment", 500);
    }
    await db.from("orders").update({ prepaid_credit_id: credit.id }).eq("id", order.id);
  }

  if (customer.created) {
    const id = customer.id;
    try {
      after(() => fillCustomerAreas(createServiceRoleClient(), { customerIds: [id] }).catch(() => undefined));
    } catch {
      // Outside a request (tests); the nightly area cron fills it in.
    }
  }

  return NextResponse.json({
    ok: true,
    order_id: order.id,
    delivery_date: deliveryDate,
    new_customer: customer.created,
    flagged: planned.filter((l) => l.note).map((l) => l.siteName),
  });
}
