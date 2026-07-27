// CLAUDE.md: "Timezone: Asia/Kolkata everywhere. Store timestamps as
// timestamptz; all cutoff logic computes in IST." IST is a fixed +05:30
// offset with no DST, so plain offset arithmetic is sufficient -- no
// timezone library needed.

export const IST_OFFSET_MINUTES = 5 * 60 + 30;

// Parses a "YYYY-MM-DDTHH:mm" string (e.g. from an <input type="datetime-local">
// understood to represent IST wall-clock time) into the equivalent UTC instant.
export function istWallClockToUtc(localDateTime: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localDateTime);
  if (!match) {
    throw new Error(`Invalid IST datetime-local value: ${localDateTime}`);
  }
  const [, year, month, day, hour, minute] = match;
  const asIfUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  return new Date(asIfUtc - IST_OFFSET_MINUTES * 60_000);
}

// Inverse of istWallClockToUtc: formats a UTC instant as the "YYYY-MM-DDTHH:mm"
// IST wall-clock string suitable for pre-filling a datetime-local input.
export function utcToIstDatetimeLocal(date: Date): string {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = shifted.getUTCFullYear();
  const month = pad(shifted.getUTCMonth() + 1);
  const day = pad(shifted.getUTCDate());
  const hour = pad(shifted.getUTCHours());
  const minute = pad(shifted.getUTCMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

const displayFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatIstDisplay(date: Date): string {
  return `${displayFormatter.format(date)} IST`;
}
