// Website orders straight to packing (admin, 2026-11-11). The storefront
// (goodfruit.club, separate app) POSTs each confirmed order to
// /api/website/orders: cash on delivery as soon as it's placed, online orders
// once Razorpay confirms payment. Pure rules here; tested in
// tests/website/ingest.test.ts.
//
// Admin decisions:
//   * Prices: the site price the customer saw is locked on each line and
//     kept at billing (recorded as a price override), still billed on the
//     actual packed weight / count.
//   * Paid online: the amount paid is posted as a credit for that order; its
//     bill uses it first, a weight difference carries to the balance.
//   * The site's delivery fee is billed as a "Delivery" line.
//   * A line whose site unit doesn't match the OMS product's unit (site "box",
//     OMS "kg") can't use the site price: it's flagged and priced from the
//     OMS list at billing.

export interface WebsiteLine {
  name: string;
  qty: number;
  unit: string | null;
  pricePerUnit: number;
}

export interface WebsiteOrder {
  orderNo: string; // GFC-1234
  placedAt: Date;
  paymentMode: "COD" | "ONLINE";
  paid: boolean; // online payment confirmed
  customer: { name: string; phone: string; address: string; pincode: string | null; email: string | null };
  lines: WebsiteLine[];
  deliveryFee: number;
  total: number; // what the customer pays / paid, delivery included
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function parseWebsiteOrder(body: unknown): { ok: true; order: WebsiteOrder } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const orderNo = str(b.order_no);
  if (!/^GFC-\d+$/.test(orderNo)) return { ok: false, error: "order_no must look like GFC-1234" };
  const placedAt = b.placed_at ? new Date(str(b.placed_at)) : new Date();
  if (Number.isNaN(placedAt.getTime())) return { ok: false, error: "placed_at is not a valid date" };
  const paymentMode = str(b.payment_mode).toUpperCase();
  if (paymentMode !== "COD" && paymentMode !== "ONLINE") return { ok: false, error: "payment_mode must be COD or ONLINE" };
  const paid = str(b.payment_status).toLowerCase() === "paid";
  // An online order comes over once it's paid -- or when the admin sends it
  // from the site's admin page (then nothing is credited as paid).
  if (paymentMode === "ONLINE" && !paid && b.admin_confirmed !== true) {
    return { ok: false, error: "an online order is sent only once it's paid" };
  }

  const c = (b.customer ?? {}) as Record<string, unknown>;
  const customer = {
    name: str(c.name),
    phone: str(c.phone),
    address: str(c.address),
    pincode: str(c.pincode) || null,
    email: str(c.email) || null,
  };
  if (!customer.name || !customer.address) return { ok: false, error: "customer name and address are required" };
  if (phoneKey(customer.phone) === null) return { ok: false, error: "customer phone must be a 10-digit number" };

  if (!Array.isArray(b.lines) || b.lines.length === 0) return { ok: false, error: "at least one line is required" };
  const lines: WebsiteLine[] = [];
  for (const raw of b.lines as Record<string, unknown>[]) {
    const line = { name: str(raw?.name), qty: num(raw?.qty), unit: str(raw?.unit) || null, pricePerUnit: num(raw?.price_per_unit) };
    if (!line.name || !Number.isFinite(line.qty) || line.qty <= 0 || !Number.isFinite(line.pricePerUnit) || line.pricePerUnit < 0) {
      return { ok: false, error: "each line needs a name, qty > 0 and price_per_unit >= 0" };
    }
    lines.push(line);
  }
  const deliveryFee = b.delivery_fee === undefined || b.delivery_fee === null ? 0 : num(b.delivery_fee);
  const total = num(b.total);
  if (!Number.isFinite(deliveryFee) || deliveryFee < 0) return { ok: false, error: "delivery_fee must be >= 0" };
  if (!Number.isFinite(total) || total < 0) return { ok: false, error: "total must be >= 0" };
  return { ok: true, order: { orderNo, placedAt, paymentMode, paid, customer, lines, deliveryFee, total } };
}

// Last 10 digits of an Indian mobile number, for matching customers whatever
// the formatting ("+91 98xxx", "098xxx", "98xxx").
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const ten = digits.length >= 10 ? digits.slice(-10) : "";
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

const UNIT_SYNONYMS: Record<string, string> = {
  kg: "kg", kgs: "kg", kilo: "kg", kilogram: "kg",
  pc: "piece", pcs: "piece", piece: "piece", pieces: "piece", nos: "piece", no: "piece",
  box: "box", boxes: "box",
  dozen: "dozen", dz: "dozen",
  tube: "tube", tubes: "tube",
  pack: "pack", packet: "pack",
};

export function normalizeUnit(unit: string | null | undefined): string {
  const u = String(unit ?? "").trim().toLowerCase();
  return UNIT_SYNONYMS[u] ?? u;
}

export function unitsMatch(siteUnit: string | null, omsUnit: string | null): boolean {
  if (!siteUnit || !omsUnit) return false;
  return normalizeUnit(siteUnit) === normalizeUnit(omsUnit);
}

export interface CatalogProduct {
  id: string;
  name: string;
  aliases: string[];
  unitLabel: string | null;
}

export function matchProduct(name: string, catalog: CatalogProduct[]): CatalogProduct | null {
  const n = name.trim().toLowerCase();
  return (
    catalog.find((p) => p.name.trim().toLowerCase() === n) ??
    catalog.find((p) => p.aliases.some((a) => a.trim().toLowerCase() === n)) ??
    null
  );
}

export interface PlannedLine {
  siteName: string;
  productId: string | null; // null = not in the OMS catalog yet
  orderedQty: number;
  orderedUnit: string | null;
  lockedPrice: number | null; // the site price, when units match
  keepSitePrice: boolean; // record a price override so billing keeps it
  flagged: boolean;
  note: string | null;
}

export function planLines(lines: WebsiteLine[], catalog: CatalogProduct[]): PlannedLine[] {
  return lines.map((l) => {
    const product = matchProduct(l.name, catalog);
    if (!product) {
      return { siteName: l.name, productId: null, orderedQty: l.qty, orderedUnit: l.unit, lockedPrice: l.pricePerUnit, keepSitePrice: true, flagged: true, note: `Website item not in the OMS catalog: ${l.name}` };
    }
    if (!unitsMatch(l.unit, product.unitLabel)) {
      return {
        siteName: l.name,
        productId: product.id,
        orderedQty: l.qty,
        orderedUnit: l.unit,
        lockedPrice: null,
        keepSitePrice: false,
        flagged: true,
        note: `Website: ${l.qty} ${l.unit ?? ""} at ₹${l.pricePerUnit}/${l.unit ?? "unit"}; OMS sells it per ${product.unitLabel ?? "unit"} — priced from the OMS list`,
      };
    }
    return { siteName: l.name, productId: product.id, orderedQty: l.qty, orderedUnit: product.unitLabel ?? l.unit, lockedPrice: l.pricePerUnit, keepSitePrice: true, flagged: false, note: null };
  });
}

// The order's text on Manage Orders / audit (orders.raw_paste): readable, and
// carrying the GFC number so the channel trigger marks it as website.
export function websiteOrderText(o: WebsiteOrder): string {
  const items = o.lines.map((l) => `${l.qty} ${l.unit ?? ""} ${l.name} @ ₹${l.pricePerUnit}`.replace(/\s+/g, " "));
  return [
    `Website order ${o.orderNo} (${o.paymentMode === "ONLINE" ? "paid online" : "cash on delivery"})`,
    o.customer.name,
    o.customer.phone,
    o.customer.address + (o.customer.pincode ? ` ${o.customer.pincode}` : ""),
    ...items,
    ...(o.deliveryFee > 0 ? [`Delivery ₹${o.deliveryFee}`] : []),
    `Total ₹${o.total}`,
  ].join("\n");
}

// A pasted WhatsApp message that carries a site order number already sent
// over automatically would double the order: these are the numbers to check.
export function siteOrderNumbers(text: string): string[] {
  return [...new Set((text.match(/GFC-\d{3,}/gi) ?? []).map((s) => s.toUpperCase()))];
}
