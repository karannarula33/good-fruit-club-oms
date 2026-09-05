// "Download Delivery Sheet" on the Dispatch screen: a plain browser-
// navigable GET (linked from an <a href>, not a fetch) so the PDF triggers
// a normal file download, same Content-Disposition pattern as the CSV
// export at src/app/api/admin/orders/export/route.ts. Renders with
// @react-pdf/renderer (no headless browser) so it stays a normal Vercel
// Function. Devanagari text is embedded via a vendored Noto Sans
// Devanagari TTF (src/assets/fonts) -- the woff2 build available via npm
// font packages crashed pdfkit's subsetter, and even where it didn't, the
// unsubsetted TTF is what actually shapes conjuncts/matras correctly.

import path from "path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { ZONE_HEADER_LABEL, deriveZoneFromAddress, type Zone } from "@/lib/customers/zone";
import { buildDeliverySheetZoneGroups, formatDeliveryDateHeader } from "@/lib/orders/delivery-sheet";
import type { PackagingType } from "@/lib/supabase/database.types";

Font.register({
  family: "NotoDevanagari",
  fonts: [
    { src: path.resolve(process.cwd(), "src/assets/fonts/NotoSansDevanagari-Regular.ttf"), fontWeight: "normal" },
    { src: path.resolve(process.cwd(), "src/assets/fonts/NotoSansDevanagari-Bold.ttf"), fontWeight: "bold" },
  ],
});

const GREEN = "#2F5D3A";

const styles = StyleSheet.create({
  page: { fontFamily: "NotoDevanagari", fontSize: 9, padding: 24, color: "#1A1A1A" },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  title: { fontSize: 15, fontWeight: "bold", width: "62%" },
  meta: { fontSize: 9, textAlign: "right", width: "36%" },
  rule: { borderBottomWidth: 2, borderBottomColor: GREEN, marginBottom: 10 },
  zoneBlock: { marginBottom: 10 },
  zoneHeader: { backgroundColor: GREEN, color: "#FFFFFF", fontWeight: "bold", fontSize: 10, padding: 5 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#DDDDDD" },
  headerRow: { flexDirection: "row", backgroundColor: "#F0EFE9", fontWeight: "bold" },
  cell: { padding: 5, justifyContent: "center" },
  colOrder: { width: "6%" },
  colCustomer: { width: "24%" },
  colAddress: { width: "40%" },
  colPackages: { width: "14%" },
  colAmount: { width: "16%", textAlign: "right" },
  contact: { fontSize: 8, color: "#555555" },
  codLabel: { fontSize: 7.5, fontWeight: "bold", color: GREEN },
  amount: { fontWeight: "bold" },
});

interface DeliverySheetOrderRow {
  orderNumber: number;
  customerName: string;
  address: string;
  phone: string | null;
  packagingCodes: string;
  isCod: boolean;
  amount: number | null;
}

function formatRupees(amount: number): string {
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(amount))}`;
}

function DeliverySheetDocument({
  date,
  zoneGroups,
}: {
  date: string;
  zoneGroups: { zone: Zone; rows: DeliverySheetOrderRow[] }[];
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>GOOD FRUIT CLUB — Delivery Sheet — डिलीवरी शीट</Text>
          <Text style={styles.meta}>
            Delivery Date: {formatDeliveryDateHeader(date)} | Delivered by: ________________
          </Text>
        </View>
        <View style={styles.rule} />

        {zoneGroups.map((group) => (
          <View key={group.zone} style={styles.zoneBlock} wrap={false}>
            <Text style={styles.zoneHeader}>{ZONE_HEADER_LABEL[group.zone]}</Text>
            <View style={styles.headerRow}>
              <Text style={[styles.cell, styles.colOrder]}>Order #</Text>
              <Text style={[styles.cell, styles.colCustomer]}>Customer Name / ग्राहक नाम</Text>
              <Text style={[styles.cell, styles.colAddress]}>Address</Text>
              <Text style={[styles.cell, styles.colPackages]}>Packages / पैकेज</Text>
              <Text style={[styles.cell, styles.colAmount]}>Amount</Text>
            </View>
            {group.rows.map((row) => (
              <View key={row.orderNumber} style={styles.row} wrap={false}>
                <Text style={[styles.cell, styles.colOrder]}>{row.orderNumber}</Text>
                <Text style={[styles.cell, styles.colCustomer]}>{row.customerName}</Text>
                <View style={[styles.cell, styles.colAddress]}>
                  <Text>{row.address}</Text>
                  {row.isCod && <Text style={styles.codLabel}>COD</Text>}
                  {row.phone && <Text style={styles.contact}>Contact: {row.phone}</Text>}
                </View>
                <Text style={[styles.cell, styles.colPackages]}>{row.packagingCodes}</Text>
                <Text style={[styles.cell, styles.colAmount, styles.amount]}>
                  {row.amount !== null ? formatRupees(row.amount) : ""}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function GET(request: Request) {
  await requireRole(["admin"]);

  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? utcToIstDatetimeLocal(new Date()).slice(0, 10);

  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("orders")
    .select("id, customer_id, created_at, customers(display_name, phone, address, zone, payment_mode)")
    .eq("delivery_date", date)
    .not("status", "in", "(recorded,cancelled)");

  const orderIds = (orders ?? []).map((o) => o.id);

  const [{ data: bills }, { data: orderLines }, { data: packages }] = await Promise.all([
    orderIds.length
      ? supabase.from("bills").select("order_id, net_due").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? supabase.from("order_lines").select("order_id, package_id").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? supabase.from("order_packages").select("id, order_id, packaging_type").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
  ]);

  const netDueByOrderId = new Map((bills ?? []).map((b) => [b.order_id, b.net_due]));

  const rawOrders = (orders ?? [])
    .filter((order) => netDueByOrderId.has(order.id))
    .map((order) => {
      const customer = order.customers as unknown as {
        display_name: string;
        phone: string | null;
        address: string;
        zone: Zone;
        payment_mode: "cod" | "online";
      } | null;
      const zone = customer?.zone ?? deriveZoneFromAddress(customer?.address ?? "");
      return {
        id: order.id,
        createdAt: order.created_at,
        customerName: customer?.display_name ?? "Unknown customer",
        address: customer?.address ?? "",
        phone: customer?.phone ?? null,
        zone,
        paymentMode: customer?.payment_mode ?? ("online" as const),
        netDue: netDueByOrderId.get(order.id) ?? 0,
      };
    });

  const zoneGroups = buildDeliverySheetZoneGroups(
    rawOrders,
    orderLines ?? [],
    (packages ?? []).map((p) => ({ id: p.id, order_id: p.order_id, packaging_type: p.packaging_type as PackagingType })),
  );

  const buffer = await renderToBuffer(<DeliverySheetDocument date={date} zoneGroups={zoneGroups} />);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="delivery_sheet_${date}.pdf"`,
    },
  });
}
