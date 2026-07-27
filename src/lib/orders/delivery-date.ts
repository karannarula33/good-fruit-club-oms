// CLAUDE.md §3.1: placed before 10:00 IST -> same-day delivery; at/after
// 10:00 IST -> next day. A suggestion with human override -- the review
// screen shows this and lets the admin change it; the final delivery_date
// is stored and never recomputed.

import { IST_OFFSET_MINUTES } from "@/lib/time/ist";

const DELIVERY_CUTOFF_HOUR_IST = 10;

export function deriveDeliveryDate(placedAtUtc: Date): string {
  // Same "represent IST wall-clock via UTC getters" trick used in
  // src/lib/time/ist.ts, so date arithmetic (day rollover) is correct.
  const shifted = new Date(placedAtUtc.getTime() + IST_OFFSET_MINUTES * 60_000);

  if (shifted.getUTCHours() >= DELIVERY_CUTOFF_HOUR_IST) {
    shifted.setUTCDate(shifted.getUTCDate() + 1);
  }

  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
