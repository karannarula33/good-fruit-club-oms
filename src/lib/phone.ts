// India-only for phase 1 (Good Fruit Club serves Gurgaon).

export function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

// What wa.me/<digits> needs -- E.164 minus the leading "+".
export function toWhatsAppDigits(phone: string): string {
  return toE164(phone).replace(/^\+/, "");
}
