import { describe, expect, it } from "vitest";
import { cleanCancelReason, lineEditGuard, removeLineGuard, toPackGuard, validQty } from "@/lib/orders/pack-edit";

describe("toPackGuard", () => {
  it("allows a recorded, unbilled order", () => expect(toPackGuard("recorded", false).ok).toBe(true));
  it("blocks a billed order", () => expect(toPackGuard("recorded", true).ok).toBe(false));
  it.each(["packed", "dispatched", "delivered", "cancelled"] as const)("blocks %s", (s) =>
    expect(toPackGuard(s, false).ok).toBe(false),
  );
});

describe("line guards", () => {
  it("edits pending items only", () => {
    expect(lineEditGuard("pending").ok).toBe(true);
    expect(lineEditGuard("packed").ok).toBe(false);
    expect(lineEditGuard("unavailable").ok).toBe(false);
  });
  it("won't remove the last item", () => {
    expect(removeLineGuard(0).ok).toBe(false);
    expect(removeLineGuard(1).ok).toBe(true);
  });
});

describe("cleanCancelReason", () => {
  it("needs a reason", () => {
    expect(cleanCancelReason("").ok).toBe(false);
    expect(cleanCancelReason("  no ").ok).toBe(false);
    expect(cleanCancelReason(undefined).ok).toBe(false);
  });
  it("tidies whitespace and caps length", () => {
    expect(cleanCancelReason("  customer\n cancelled ")).toEqual({ ok: true, reason: "customer cancelled" });
    const r = cleanCancelReason("x".repeat(500));
    expect(r.ok && r.reason.length).toBe(300);
  });
});

describe("validQty", () => {
  it("accepts positive quantities under 1000", () => {
    expect(validQty(0.5)).toBe(true);
    expect(validQty(0)).toBe(false);
    expect(validQty(-1)).toBe(false);
    expect(validQty(NaN)).toBe(false);
    expect(validQty(1000)).toBe(false);
  });
});
