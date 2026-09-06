// Manage Orders "Download" feature: a plain browser-navigable GET (linked
// from an <a href>, not a fetch) so Content-Disposition triggers a normal
// file download. Line-grain workbook -- one row per order line, with order/
// customer/bill fields repeated on every line -- so it opens straight into
// a pivotable spreadsheet (sum qty by product, filter by zone, etc.). Real
// .xlsx (not CSV) specifically so the Packaging column can merge cells: a
// box holding several line items shows its label once, spanning those
// rows, since packaging is recorded per physical box/packet
// (order_packages) with each line pointing at the one it went into, not a
// single label per order.

import ExcelJS from "exceljs";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { derivePaymentStatus } from "@/lib/billing/compute";
import { formatIstDisplay } from "@/lib/time/ist";
import { PACKAGING_LABEL } from "@/lib/packing/packaging";
import type { PackagingType } from "@/lib/supabase/database.types";

const HEADER = [
  "Order ID",
  "Placed At",
  "Delivery Date",
  "Customer",
  "Phone",
  "Address",
  "Zone",
  "Packaging",
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
const PACKAGING_COL = HEADER.indexOf("Packaging") + 1;
const WIDE_COLUMNS: Record<string, number> = {
  "Order ID": 20,
  Customer: 20,
  Address: 32,
  Packaging: 14,
  Product: 20,
  "Order Notes": 24,
};

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
  package_id: string | null;
}

// Groups an order's lines by the box/packet they share (order_lines.package_id),
// preserving first-appearance order -- lines with no package_id each form
// their own singleton group, since there's nothing to merge them with.
function groupLinesByPackage(lines: ExportOrderLine[]): ExportOrderLine[][] {
  const groups = new Map<string, ExportOrderLine[]>();
  const order: string[] = [];
  for (const line of lines) {
    const key = line.package_id ?? `__unpackaged_${line.id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(line);
  }
  return order.map((key) => groups.get(key)!);
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

  const [{ data: customers }, { data: orderLines }, { data: products }, { data: bills }, { data: allocations }, { data: packages }] =
    await Promise.all([
      customerIds.length
        ? supabase.from("customers").select("id, display_name, phone, address, zone").in("id", customerIds)
        : Promise.resolve({ data: [] }),
      orderIds.length
        ? supabase
            .from("order_lines")
            .select(
              "id, order_id, product_id, ordered_qty, ordered_unit, locked_price_per_unit, actual_qty, line_status, is_substitution, package_id",
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
      orderIds.length
        ? supabase.from("order_packages").select("id, order_id, packaging_type").in("order_id", orderIds)
        : Promise.resolve({ data: [] }),
    ]);

  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));
  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const billByOrderId = new Map((bills ?? []).map((b) => [b.order_id, b]));
  const packagingTypeByPackageId = new Map(
    (packages ?? []).map((p) => [p.id, p.packaging_type as PackagingType]),
  );

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

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Orders");
  sheet.addRow(HEADER);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  HEADER.forEach((name, i) => {
    sheet.getColumn(i + 1).width = WIDE_COLUMNS[name] ?? 12;
  });

  let currentRow = 2;

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
    ];
    const statusFields = [
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
      sheet.addRow([...orderFields, "", ...statusFields, "", "", "", "", "", "", "", "", "", ...billFields]);
      currentRow += 1;
      continue;
    }

    for (const group of groupLinesByPackage(lines)) {
      const groupStartRow = currentRow;
      const packagingLabel = group[0].package_id ? (PACKAGING_LABEL[packagingTypeByPackageId.get(group[0].package_id)!] ?? "") : "";

      group.forEach((line, i) => {
        const product = line.product_id ? productById.get(line.product_id) : undefined;
        const lineAmount =
          line.actual_qty !== null && line.locked_price_per_unit !== null
            ? Math.round(line.actual_qty * line.locked_price_per_unit * 100) / 100
            : "";
        sheet.addRow([
          ...orderFields,
          i === 0 ? packagingLabel : "",
          ...statusFields,
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
        currentRow += 1;
      });

      const groupEndRow = currentRow - 1;
      if (groupEndRow > groupStartRow) {
        sheet.mergeCells(groupStartRow, PACKAGING_COL, groupEndRow, PACKAGING_COL);
        sheet.getCell(groupStartRow, PACKAGING_COL).alignment = { vertical: "middle" };
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();

  const filename = from === to ? `orders_${from}.xlsx` : `orders_${from}_to_${to}.xlsx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
