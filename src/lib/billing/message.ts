// CLAUDE.md §3.8: the exact WhatsApp bill text, stored verbatim in
// bills.message_text and sent via a wa.me deep link. Field order:
// greeting, delivery date, line items, order total, previous balance /
// advance, net amount due (always shown, never optional), payment line.
// All customer-facing communication is from Sunita's identity -- the
// greeting introduces her; sign-off is the user's exact chosen text.

const UPI_ID = "karannarula20@okhdfcbank";
const SIGN_OFF = "– Good Fruit Club";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Parses a plain "YYYY-MM-DD" calendar date without going through Date
// (which would risk a UTC/IST off-by-one day shift) -- delivery_date has
// no time component to begin with.
function formatDateOnly(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

function formatRupees(amount: number): string {
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `₹${formatted}`;
}

export interface BillLineItem {
  productName: string;
  actualQty: number;
  unitLabel: string | null;
  ratePerUnit: number;
  amount: number;
}

export function buildBillMessage(params: {
  customerName: string;
  deliveryDate: string;
  lines: BillLineItem[];
  total: number;
  prevBalance: number;
  netDue: number;
}): string {
  const { customerName, deliveryDate, lines, total, prevBalance, netDue } = params;

  const lineText =
    lines.length > 0
      ? lines
          .map(
            (line) =>
              `${line.actualQty} ${line.unitLabel ?? ""} ${line.productName} @ ${formatRupees(line.ratePerUnit)} = ${formatRupees(line.amount)}`,
          )
          .join("\n")
      : "No items packed";

  const balanceLabel = prevBalance < 0 ? "Advance" : "Previous balance";
  const balanceLine = `${balanceLabel}: ${formatRupees(Math.abs(prevBalance))}`;

  return [
    `Hi ${customerName},`,
    "",
    `Here's your Good Fruit Club bill for ${formatDateOnly(deliveryDate)}:`,
    "",
    lineText,
    "",
    `Order total: ${formatRupees(total)}`,
    balanceLine,
    `Net amount due: ${formatRupees(netDue)}`,
    "",
    `Pay via UPI: ${UPI_ID}`,
    "or Cash on Delivery.",
    "",
    SIGN_OFF,
  ].join("\n");
}
