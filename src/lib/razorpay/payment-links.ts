// Razorpay Payment Links, server-side only (the key secret never reaches the
// browser). Docs: https://razorpay.com/docs/api/payments/payment-links/
//
// Configured by three env vars on the OMS Vercel project:
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET  -- API keys (same Razorpay account as the website)
//   RAZORPAY_WEBHOOK_SECRET              -- secret of the webhook pointing at /api/razorpay/webhook
// With the keys missing, bills simply go out without a link.

import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.razorpay.com/v1";

export function paymentLinksEnabled(): boolean {
  return !!process.env.RAZORPAY_KEY_ID && !!process.env.RAZORPAY_KEY_SECRET;
}

function authHeader(): string {
  const id = process.env.RAZORPAY_KEY_ID ?? "";
  const secret = process.env.RAZORPAY_KEY_SECRET ?? "";
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

// Razorpay wants a phone with country code; customer phones are stored as
// typed (10 digits, +91..., 0091..., with spaces). Returns null when it isn't
// a plausible Indian mobile, in which case the link is made without one.
export function toRazorpayContact(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  const local = digits.length === 10 ? digits : digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : null;
  return local && /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

// reference_id must be unique across the account and at most 40 characters.
export function linkReferenceId(orderId: string, now = Date.now()): string {
  return `gfc-${orderId.replace(/-/g, "").slice(0, 16)}-${now.toString(36)}`;
}

export interface CreatedLink {
  id: string;
  shortUrl: string;
}

export async function createPaymentLink(params: {
  orderId: string;
  customerId: string;
  amount: number; // rupees
  customerName: string;
  phone: string | null;
  description: string;
}): Promise<{ ok: true; link: CreatedLink } | { ok: false; error: string }> {
  const contact = toRazorpayContact(params.phone);
  const body = {
    amount: Math.round(params.amount * 100), // paise
    currency: "INR",
    accept_partial: false,
    description: params.description.slice(0, 2048),
    reference_id: linkReferenceId(params.orderId),
    customer: { name: params.customerName.slice(0, 100), ...(contact ? { contact } : {}) },
    // The bill goes out on WhatsApp from Sunita; Razorpay shouldn't send its own SMS/email.
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes: { order_id: params.orderId, customer_id: params.customerId, source: "oms_bill" },
  };
  try {
    const res = await fetch(`${API}/payment_links`, {
      method: "POST",
      headers: { Authorization: authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; short_url?: string; error?: { description?: string } };
    if (!res.ok || !json.id || !json.short_url) {
      return { ok: false, error: json.error?.description ?? `Razorpay returned ${res.status}` };
    }
    return { ok: true, link: { id: json.id, shortUrl: json.short_url } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach Razorpay" };
  }
}

export async function cancelPaymentLink(linkId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/payment_links/${encodeURIComponent(linkId)}/cancel`, {
      method: "POST",
      headers: { Authorization: authHeader() },
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Razorpay signs the raw request body with the webhook secret (HMAC-SHA256, hex).
export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
