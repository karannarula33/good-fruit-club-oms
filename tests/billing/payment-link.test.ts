import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ledgerModeForMethod, planLinkPaymentAllocation, unpaidForOrder } from "@/lib/billing/payment-link";
import { addPaymentLinkToMessage, buildBillMessage } from "@/lib/billing/message";
import { linkReferenceId, toRazorpayContact, verifyWebhookSignature } from "@/lib/razorpay/payment-links";

describe("payment link amount", () => {
  it("asks for the order's unpaid amount only, never below zero", () => {
    expect(unpaidForOrder(1240, 0)).toBe(1240);
    expect(unpaidForOrder(1240, 500)).toBe(740);
    expect(unpaidForOrder(1240, 1240)).toBe(0); // prepaid on the website / covered by an advance: no link
    expect(unpaidForOrder(1240, 2000)).toBe(0);
    expect(unpaidForOrder(100.1, 0.2)).toBe(99.9);
  });

  it("allocates a link payment to the order up to what it owes; the rest stays an advance", () => {
    expect(planLinkPaymentAllocation(1240, 1240)).toBe(1240);
    expect(planLinkPaymentAllocation(1500, 1240)).toBe(1240);
    expect(planLinkPaymentAllocation(1240, 0)).toBe(0); // paid in cash meanwhile: whole payment becomes an advance
  });

  it("records UPI as upi and everything else as other", () => {
    expect(ledgerModeForMethod("upi")).toBe("upi");
    expect(ledgerModeForMethod("card")).toBe("other");
    expect(ledgerModeForMethod(null)).toBe("other");
  });
});

describe("Razorpay request details", () => {
  it("normalises Indian mobile numbers and drops anything else", () => {
    expect(toRazorpayContact("98110 12345")).toBe("+919811012345");
    expect(toRazorpayContact("+91-9811012345")).toBe("+919811012345");
    expect(toRazorpayContact("09811012345")).toBe("+919811012345");
    expect(toRazorpayContact("0124 4001234")).toBeNull();
    expect(toRazorpayContact(null)).toBeNull();
  });

  it("keeps reference ids within Razorpay's 40 characters and unique per attempt", () => {
    const id = "3f1c2b9e-1234-4abc-9def-0123456789ab";
    const a = linkReferenceId(id, 1_790_000_000_000);
    expect(a.length).toBeLessThanOrEqual(40);
    expect(a).not.toBe(linkReferenceId(id, 1_790_000_000_001));
  });

  it("accepts only correctly signed webhook bodies", () => {
    const body = JSON.stringify({ event: "payment_link.paid" });
    const sig = createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(verifyWebhookSignature(body, sig, "s3cret")).toBe(true);
    expect(verifyWebhookSignature(body, sig, "other")).toBe(false);
    expect(verifyWebhookSignature(`${body} `, sig, "s3cret")).toBe(false);
    expect(verifyWebhookSignature(body, null, "s3cret")).toBe(false);
  });
});

describe("bill message with a payment link", () => {
  const base = {
    salutation: "Ma'am" as const,
    deliveryDate: "2026-10-09",
    lines: [{ productName: "Papaya", actualQty: 1.2, unitLabel: "kg", ratePerUnit: 160, amount: 192 }],
    total: 192,
    prevBalance: 500,
    netDue: 692,
  };

  it("puts the link, for this bill's amount, above the UPI line and keeps the net due", () => {
    const text = buildBillMessage({ ...base, paymentLink: { url: "https://rzp.io/rzp/abc", amount: 192 } });
    const lines = text.split("\n");
    const at = lines.indexOf("Pay this bill online (₹192):");
    expect(at).toBeGreaterThan(lines.indexOf("Net amount due: ₹692"));
    expect(lines[at + 1]).toBe("https://rzp.io/rzp/abc");
    expect(lines[at + 3]).toBe("Pay via UPI: karannarula20@okhdfcbank");
    expect(text.endsWith("– Good Fruit Club")).toBe(true);
  });

  it("is unchanged when there is no link", () => {
    expect(buildBillMessage({ ...base, paymentLink: null })).toBe(buildBillMessage(base));
    expect(buildBillMessage(base)).not.toContain("online");
  });

  it("adds a later link to an existing bill exactly as a new bill would have it", () => {
    const link = { url: "https://rzp.io/rzp/xyz", amount: 192 };
    const added = addPaymentLinkToMessage(buildBillMessage(base), link);
    expect(added).toBe(buildBillMessage({ ...base, paymentLink: link }));
    expect(addPaymentLinkToMessage(added, link)).toBe(added); // never twice
  });
});
