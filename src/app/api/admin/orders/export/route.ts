// Manage Orders "Download" feature: a plain browser-navigable GET (linked
// from an <a href>, not a fetch) so Content-Disposition triggers a normal
// file download. Line-grain CSV -- one row per order line, with order/
// customer/bill fields repeated on every line -- so it opens straight into
// a pivotable spreadsheet (sum qty by product, filter by zone, etc.).

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { derivePaymentStatus } from "@/lib/billing/compute";
import { formatIstDisplay } from "@/lib/time/ist";

function csvField(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function csvRow(values: (string | number | null | undefined)[]): string {
  return values.map(csvField).join(",") + "\r\n";
}

const HEADER = [
  "Order ID",
  "Placed At",
  "Delivery Date",
  "Customer",
  "Phone",
  "Address",
  "Zone",
  "Order Status",
  "Packed At",
  "Dispatched At",
  "Out For Delivery At",
  "Delivered At",
  "Product",
  "Ordered Qty",
  "Ordered Unit",
  "Actual Qty",
  "Unit Label",
  "Rate (per unit)",
  "Line Status",
  "Substitution",
  "Line Amount",
  "Bill Total",
  "Prev Balance",
  "Net Due",
  "Amount Paid",
  "Payment Status",
  "Bill Finalized At",
  "Order Notes",
];

interface ExportOrderLine {
  id: string;
  order_id: string;
  product_id: string | null;
  ordered_qty: number | null;
  ordered_unit: string | null;
  locked_price_per_unit: number | null;
  actual_qty: number | null;
  line_status: string;
  is_substitution: boolean;
}

export async function GET(request: Request) {
  await requireRole(["admin"]);

  const url = new URL(request.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  if (!fromParam || !toParam) {
    return new Response("Missing from/to date", { status: 400 });
  }
  const from = fromParam <= toParam ? fromParam : toParam;
  const to = fromParam <= toParam ? toParam : fromParam;

  const supabase = await createClient();

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, customer_id, placed_at, delivery_date, status, status_timestamps, notes")
    .gte("delivery_date", from)
    .lte("delivery_date", to)
    .order("delivery_date", { ascending: true });
  if (ordersError) {
    return new Response(ordersError.message, { status: 500 });
  }

  const orderIds = (orders ?? []).map((o) => o.id);
  const customerIds = [...new Set((orders ?? []).map((o) => o.customer_id))];

  const [{ data: customers }, { data: orderLines }, { data: products }, { data: bills }, { data: allocations }] =
    await Promise.all([
      customerIds.length
        ? supabase.from("customers").select("id, display_name, phone, address, zone").in("id", customerIds)
        : Promise.resolve({ data: [] }),
      orderIds.length
        ? supabase
            .from("order_lines")
            .select(
              "id, order_id, product_id, ordered_qty, ordered_unit, locked_price_per_unit, actual_qty, line_status, is_substitution",
            )
            .in("order_id", orderIds)
        : Promise.resolve({ data: [] }),
      supabase.from("products").select("id, name, unit_label"),
      orderIds.length
        ? supabase.from("bills").select("order_id, total, prev_balance, net_due, finalized_at").in("order_id", orderIds)
        : Promise.resolve({ data: [] }),
      orderIds.length
        ? supabase.from("payment_allocations").select("order_id, amount").in("order_id", orderIds)
        : Promise.resolve({ data: [] }),
    ]);

  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));
  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const billByOrderId = new Map((bills ?? []).map((b) => [b.order_id, b]));

  const allocatedByOrderId = new Map<string, number>();
  for (const allocation of allocations ?? []) {
    allocatedByOrderId.set(allocation.order_id, (allocatedByOrderId.get(allocation.order_id) ?? 0) + allocation.amount);
  }

  const linesByOrderId = new Map<string, ExportOrderLine[]>();
  for (const line of orderLines ?? []) {
    const list = linesByOrderId.get(line.order_id) ?? [];
    list.push(line);
    linesByOrderId.set(line.order_id, list);
  }

  let csv = csvRow(HEADER);

  for (const order of orders ?? []) {
    const customer = customerById.get(order.customer_id);
    const timestamps = (order.status_timestamps ?? {}) as Record<string, string>;
    const bill = billByOrderId.get(order.id);
    const allocated = allocatedByOrderId.get(order.id) ?? 0;
    const paymentStatus = bill ? derivePaymentStatus(bill.total, allocated) : null;
    const lines = linesByOrderId.get(order.id) ?? [];

    const orderFields = [
      order.id,
      formatIstDisplay(new Date(order.placed_at)),
      order.delivery_date,
      customer?.display_name ?? "Unknown customer",
      customer?.phone ?? "",
      customer?.address ?? "",
      customer?.zone ?? "",
      order.status,
      timestamps.packed ? formatIstDisplay(new Date(timestamps.packed)) : "",
      timestamps.dispatched ? formatIstDisplay(new Date(timestamps.dispatched)) : "",
      timestamps.out_for_delivery ? formatIstDisplay(new Date(timestamps.out_for_delivery)) : "",
      timestamps.delivered ? formatIstDisplay(new Date(timestamps.delivered)) : "",
    ];
    const billFields = [
      bill?.total ?? "",
      bill?.prev_balance ?? "",
      bill?.net_due ?? "",
      bill ? allocated : "",
      paymentStatus ?? "",
      bill?.finalized_at ? formatIstDisplay(new Date(bill.finalized_at)) : "",
      order.notes ?? "",
    ];

    if (lines.length === 0) {
      csv += csvRow([...orderFields, "", "", "", "", "", "", "", "", "", ...billFields]);
      continue;
    }

    for (const line of lines) {
      const product = line.product_id ? productById.get(line.product_id) : undefined;
      const lineAmount =
        line.actual_qty !== null && line.locked_price_per_unit !== null
          ? Math.round(line.actual_qty * line.locked_price_per_unit * 100) / 100
          : "";
      csv += csvRow([
        ...orderFields,
        product?.name ?? "Unknown product",
        line.ordered_qty ?? "",
        line.ordered_unit ?? "",
        line.actual_qty ?? "",
        product?.unit_label ?? "",
        line.locked_price_per_unit ?? "",
        line.line_status,
        line.is_substitution ? "Yes" : "No",
        lineAmount,
        ...billFields,
      ]);
    }
  }

  const filename = from === to ? `orders_${from}.csv` : `orders_${from}_to_${to}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
