import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { computeCustomerBalance, derivePaymentStatus, type PaymentStatus } from "@/lib/billing/compute";
import { formatIstDisplay } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from "@/lib/orders/status-display";
import { RecordPaymentForm } from "./record-payment-form";

const PAYMENT_STATUS_TONE: Record<PaymentStatus, BadgeTone> = {
  paid: "success",
  partial: "warning",
  unpaid: "danger",
};

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const { id } = await params;

  const supabase = await createClient();

  const { data: customer } = await supabase
    .from("customers")
    .select("id, display_name, phone, address, zone")
    .eq("id", id)
    .maybeSingle();
  if (!customer) {
    notFound();
  }

  const [{ data: orders }, { data: ledgerEntries }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, delivery_date, status")
      .eq("customer_id", id)
      .order("delivery_date", { ascending: false }),
    supabase
      .from("ledger_entries")
      .select("id, entry_type, amount, mode, note, order_id, created_at")
      .eq("customer_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const orderIds = (orders ?? []).map((o) => o.id);
  const { data: bills } = orderIds.length
    ? await supabase.from("bills").select("order_id, total").in("order_id", orderIds)
    : { data: [] };
  const { data: allocations } = orderIds.length
    ? await supabase.from("payment_allocations").select("order_id, amount").in("order_id", orderIds)
    : { data: [] };

  const billByOrderId = new Map((bills ?? []).map((b) => [b.order_id, b.total]));
  const allocatedByOrderId = new Map<string, number>();
  for (const allocation of allocations ?? []) {
    allocatedByOrderId.set(allocation.order_id, (allocatedByOrderId.get(allocation.order_id) ?? 0) + allocation.amount);
  }

  const balance = computeCustomerBalance(
    (ledgerEntries ?? []).map((e) => ({ entryType: e.entry_type, amount: e.amount })),
  );

  const orderRows = (orders ?? []).map((order) => {
    const total = billByOrderId.get(order.id) ?? null;
    const allocated = allocatedByOrderId.get(order.id) ?? 0;
    const remainingDue = total !== null ? Math.round((total - allocated) * 100) / 100 : null;
    return {
      id: order.id,
      deliveryDate: order.delivery_date,
      status: order.status,
      total,
      allocated,
      remainingDue,
      paymentStatus: total !== null ? derivePaymentStatus(total, allocated) : null,
    };
  });

  const outstandingOrders = orderRows
    .filter((o) => o.remainingDue !== null && o.remainingDue > 0)
    .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))
    .map((o) => ({ id: o.id, deliveryDate: o.deliveryDate, remainingDue: o.remainingDue as number }));

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={customer.display_name}
        backHref="/admin/customers"
        backLabel="Customers"
        subtitle={
          <>
            {customer.phone ?? "No phone"} · {customer.address} · {customer.zone}
            <br />
            <span className="text-base font-medium text-foreground">
              Balance:{" "}
              {balance > 0 ? (
                <span className="text-danger-text">₹{balance.toFixed(2)} owed</span>
              ) : balance < 0 ? (
                <span className="text-success-text">₹{Math.abs(balance).toFixed(2)} advance</span>
              ) : (
                <span className="text-neutral-600 dark:text-neutral-400">₹0</span>
              )}
            </span>
          </>
        }
      />

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Orders</h2>
        <Table>
          <THead>
            <TR>
              <TH>Delivery date</TH>
              <TH>Order status</TH>
              <TH>Bill total</TH>
              <TH>Paid</TH>
              <TH>Remaining due</TH>
              <TH>Payment status</TH>
            </TR>
          </THead>
          <TBody>
            {orderRows.map((order) => (
              <TR key={order.id}>
                <TD>{order.deliveryDate}</TD>
                <TD>
                  <Badge tone={ORDER_STATUS_TONE[order.status]} size="sm">
                    {ORDER_STATUS_LABEL[order.status]}
                  </Badge>
                </TD>
                <TD>{order.total !== null ? `₹${order.total.toFixed(2)}` : "Not billed"}</TD>
                <TD>{order.total !== null ? `₹${order.allocated.toFixed(2)}` : "—"}</TD>
                <TD>{order.remainingDue !== null ? `₹${order.remainingDue.toFixed(2)}` : "—"}</TD>
                <TD>
                  {order.paymentStatus && (
                    <Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]} size="sm">
                      {order.paymentStatus}
                    </Badge>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <RecordPaymentForm customerId={customer.id} outstandingOrders={outstandingOrders} />

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Ledger history</h2>
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Type</TH>
              <TH>Amount</TH>
              <TH>Mode</TH>
              <TH>Note</TH>
            </TR>
          </THead>
          <TBody>
            {(ledgerEntries ?? []).map((entry) => (
              <TR key={entry.id}>
                <TD className="text-neutral-600 dark:text-neutral-400">{formatIstDisplay(new Date(entry.created_at))}</TD>
                <TD>
                  <Badge tone={entry.entry_type === "debit" ? "danger" : "success"} size="sm">
                    {entry.entry_type}
                  </Badge>
                </TD>
                <TD>₹{entry.amount.toFixed(2)}</TD>
                <TD className="text-neutral-600 dark:text-neutral-400">{entry.mode ?? "—"}</TD>
                <TD className="text-neutral-600 dark:text-neutral-400">{entry.note ?? "—"}</TD>
              </TR>
            ))}
            {(ledgerEntries ?? []).length === 0 && (
              <TR>
                <TD colSpan={5} className="text-neutral-500">
                  No ledger activity yet.
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </div>
    </div>
  );
}
