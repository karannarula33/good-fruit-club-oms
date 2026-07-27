import { describe, expect, it } from "vitest";
import { formatIstDisplay, istWallClockToUtc, utcToIstDatetimeLocal } from "@/lib/time/ist";

describe("istWallClockToUtc", () => {
  it("converts a known IST wall-clock time to UTC", () => {
    // 06:00 IST = 00:30 UTC (same day)
    expect(istWallClockToUtc("2026-07-27T06:00").toISOString()).toBe(
      "2026-07-27T00:30:00.000Z",
    );
  });

  it("wraps to the previous UTC day for early IST morning", () => {
    // 00:00 IST = 18:30 UTC the previous day
    expect(istWallClockToUtc("2026-07-27T00:00").toISOString()).toBe(
      "2026-07-26T18:30:00.000Z",
    );
  });

  it("wraps to the next UTC day for late IST evening", () => {
    // 23:45 IST = 18:15 UTC the next day
    expect(istWallClockToUtc("2026-07-27T23:45").toISOString()).toBe(
      "2026-07-27T18:15:00.000Z",
    );
  });
});

describe("utcToIstDatetimeLocal", () => {
  it("is the inverse of istWallClockToUtc", () => {
    const samples = [
      "2026-07-27T06:00",
      "2026-07-27T00:00",
      "2026-07-27T23:45",
      "2026-01-01T00:30",
      "2026-12-31T23:59",
    ];
    for (const local of samples) {
      const utc = istWallClockToUtc(local);
      expect(utcToIstDatetimeLocal(utc)).toBe(local);
    }
  });
});

describe("formatIstDisplay", () => {
  it("renders a non-empty IST-labeled string", () => {
    const formatted = formatIstDisplay(new Date("2026-07-27T00:30:00.000Z"));
    expect(formatted).toContain("IST");
    expect(formatted.length).toBeGreaterThan(0);
  });
});
