// Razorpay webhook for bill payment links. Set up in the Razorpay dashboard
// (Settings → Webhooks) pointing at /api/razorpay/webhook with the events
// payment_link.paid, payment_link.cancelled and payment_link.expired, and
// its secret in RAZORPAY_WEBHOOK_SECRET.
//
// Excluded from the session middleware (src/proxy.ts skips /api): it
// authenticates by the request signature, then writes with the service-role
// client because there is no signed-in user.

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { recordLinkPayment } from "@/lib/billing/payment-link";
import { verifyWebhookSignature } from "@/lib/razorpay/payment-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WebhookEvent {
  event?: string;
  payload?: {
    payment_link?: { entity?: { id?: string; status?: string } };
    payment?: { entity?: { id?: string; amount?: number; method?: string; status?: string } };
  };
}

export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Webhook not configured" }, { status: 503 });

  const rawBody = await request.text();
  if (!verifyWebhookSignature(rawBody, request.headers.get("x-razorpay-signature"), secret)) {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const linkId = event.payload?.payment_link?.entity?.id;
  if (!linkId) return Response.json({ ok: true, ignored: event.event ?? "no event" });

  const supabase = createServiceRoleClient();

  if (event.event === "payment_link.cancelled" || event.event === "payment_link.expired") {
    const status = event.event === "payment_link.cancelled" ? "cancelled" : "expired";
    await supabase.from("bills").update({ payment_link_status: status }).eq("payment_link_id", linkId).neq("payment_link_status", "paid");
    return Response.json({ ok: true });
  }

  if (event.event !== "payment_link.paid") return Response.json({ ok: true, ignored: event.event });

  const payment = event.payload?.payment?.entity;
  if (!payment?.id || !payment.amount) return Response.json({ error: "No payment in event" }, { status: 400 });

  const result = await recordLinkPayment(supabase, {
    linkId,
    paymentId: payment.id,
    amountPaise: payment.amount,
    method: payment.method ?? null,
  });
  if (result.status === "error") {
    console.error(`Razorpay webhook: could not record ${payment.id} for ${linkId}: ${result.error}`);
    // 500 makes Razorpay retry later.
    return Response.json({ error: "Could not record payment" }, { status: 500 });
  }
  if (result.status === "unknown_link") console.warn(`Razorpay webhook: no bill has payment link ${linkId}`);
  return Response.json({ ok: true, result: result.status });
}
