import { describe, expect, it } from "vitest";
import { deriveDeliveryDate } from "@/lib/orders/delivery-date";

describe("deriveDeliveryDate", () => {
  it("is same-day exactly one millisecond before the 10:00 IST cutoff", () => {
    // 09:59:59.999 IST = 04:29:59.999 UTC
    expect(deriveDeliveryDate(new Date("2026-07-27T04:29:59.999Z"))).toBe("2026-07-27");
  });

  it("is next-day exactly at the 10:00 IST cutoff", () => {
    // 10:00:00.000 IST = 04:30:00.000 UTC
    expect(deriveDeliveryDate(new Date("2026-07-27T04:30:00.000Z"))).toBe("2026-07-28");
  });

  it("rolls over a month/year boundary", () => {
    // 10:00 IST on Dec 31 -> next day is Jan 1 of the following year
    expect(deriveDeliveryDate(new Date("2026-12-31T04:30:00.000Z"))).toBe("2027-01-01");
  });

  it("uses the IST calendar day, not the UTC calendar day", () => {
    // 05:00 IST on 27 Jul is still 26 Jul in UTC -- must still resolve to
    // the IST day (27 Jul) as the same-day delivery date.
    expect(deriveDeliveryDate(new Date("2026-07-26T23:30:00.000Z"))).toBe("2026-07-27");
  });
});
