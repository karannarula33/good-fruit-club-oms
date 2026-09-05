import { ZONE_ORDER, type Zone } from "@/lib/customers/zone";
import { packagesUsedByOrder, summarizePackagingCodes } from "@/lib/packing/packaging";
import type { PackagingType } from "@/lib/supabase/database.types";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ordinal(day: number): string {
  if (day % 10 === 1 && day !== 11) return `${day}st`;
  if (day % 10 === 2 && day !== 12) return `${day}nd`;
  if (day % 10 === 3 && day !== 13) return `${day}rd`;
  return `${day}th`;
}

// "3rd September (Thursday)" -- parses a plain "YYYY-MM-DD" via Date.UTC
// (construct and read both in UTC) rather than `new Date(dateStr)`, which
// would let the server's local timezone shift the weekday.
export function formatDeliveryDateHeader(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const weekday = WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${ordinal(day)} ${MONTH_NAMES[month - 1]} (${weekday})`;
}

export interface DeliverySheetOrderRow {
  orderNumber: number;
  customerName: string;
  address: string;
  phone: string | null;
  packagingCodes: string;
  isCod: boolean;
  amount: number | null;
}

export interface DeliverySheetZoneGroup {
  zone: Zone;
  rows: DeliverySheetOrderRow[];
}

interface RawOrder {
  id: string;
  createdAt: string;
  customerName: string;
  address: string;
  phone: string | null;
  zone: Zone;
  paymentMode: "cod" | "online";
  netDue: number;
}

// Groups billed orders for a delivery date into the fixed zone route order
// (CLAUDE.md §6), assigning each order a stable number in the order it was
// originally entered -- not per-zone -- so the same order keeps the same
// number regardless of which zone section it lands in, matching how the
// admin's own hand-built sheet numbers orders (see reference PDF in repo
// root, e.g. order #1 sits in the "DLF Phase 1" section while #2-11 are in
// "DLF Phase 2", preserving entry order rather than restarting per zone).
export function buildDeliverySheetZoneGroups(
  orders: RawOrder[],
  orderLines: { order_id: string; package_id: string | null }[],
  packages: { id: string; order_id: string; packaging_type: PackagingType }[],
): DeliverySheetZoneGroup[] {
  const sortedByEntryOrder = [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const orderNumberById = new Map(sortedByEntryOrder.map((o, i) => [o.id, i + 1]));
  const packagesByOrderId = packagesUsedByOrder(orderLines, packages);

  const rowsByZone = new Map<Zone, DeliverySheetOrderRow[]>();
  for (const order of orders) {
    const rows = rowsByZone.get(order.zone) ?? [];
    rows.push({
      orderNumber: orderNumberById.get(order.id)!,
      customerName: order.customerName,
      address: order.address,
      phone: order.phone,
      packagingCodes: summarizePackagingCodes(packagesByOrderId.get(order.id) ?? []),
      isCod: order.paymentMode === "cod",
      amount: order.paymentMode === "cod" ? order.netDue : null,
    });
    rowsByZone.set(order.zone, rows);
  }

  const zoneDisplayOrder: Zone[] = [...ZONE_ORDER, "Unassigned"];
  return zoneDisplayOrder
    .filter((zone) => rowsByZone.has(zone))
    .map((zone) => ({ zone, rows: rowsByZone.get(zone)!.sort((a, b) => a.orderNumber - b.orderNumber) }));
}
