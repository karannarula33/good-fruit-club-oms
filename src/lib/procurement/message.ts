const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Parses a plain "YYYY-MM-DD" calendar date without going through Date
// (avoids a UTC/IST off-by-one shift) -- delivery_date has no time component.
function formatDateOnly(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

export interface ProcurementMessageItem {
  name: string;
  qty: number;
  unitLabel: string | null;
}

export function buildProcurementMessage(deliveryDate: string, items: ProcurementMessageItem[]): string {
  const lineText = items.map((item) => `${item.qty} ${item.unitLabel ?? ""} ${item.name}`.trim()).join("\n");

  return [`Procurement — ${formatDateOnly(deliveryDate)}`, "", lineText].join("\n");
}
