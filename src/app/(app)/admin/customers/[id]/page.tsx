import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { computeCustomerBalance, derivePaymentStatus, type PaymentStatus } from "@/lib/billing/compute";
import { formatIstDisplay } from "@/lib/time/ist";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
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
    <div className="flex flex-col gap-5 px-[18px] pt-5 pb-6">
      <PageHeader title="Account" backHref="/admin/customers" backLabel="Customers" />

      <Card elevated>
        <div className="mb-1 flex items-center gap-3">
          <Avatar name={customer.display_name} size={46} />
          <div>
            <div className="font-display text-base font-bold text-foreground">{customer.display_name}</div>
            <div className="font-sans text-[11.5px] font-medium text-muted">{customer.phone ?? "No phone"}</div>
          </div>
        </div>
        <div className="font-sans text-xs font-medium text-muted">
          {customer.address} · {customer.zone}
        </div>
        <div className="flex items-center justify-between border-t border-dashed border-[#ECEAE3] pt-3.5">
          <div className="font-sans text-[13px] font-semibold text-[#5b5e66]">Balance due</div>
          <div className="font-display text-xl font-extrabold text-foreground">
            {balance > 0 ? (
              `₹${balance.toFixed(2)}`
            ) : balance < 0 ? (
              <span className="text-success-text">₹{Math.abs(balance).toFixed(2)} advance</span>
            ) : (
              "₹0"
            )}
          </div>
        </div>
      </Card>

      <RecordPaymentForm customerId={customer.id} outstandingOrders={outstandingOrders} />

      <div className="flex flex-col gap-2">
        <div className="px-0.5 font-sans text-[11px] font-bold uppercase tracking-wide text-muted">Order history</div>
        {orderRows.map((order) => (
          <Card key={order.id} elevated className="flex items-center justify-between !space-y-0">
            <div className="font-sans text-[13.5px] font-bold text-foreground">{order.deliveryDate}</div>
            {order.paymentStatus && (
              <Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]} size="sm">
                {order.paymentStatus}
              </Badge>
            )}
            <div className="font-display text-sm font-bold text-foreground">
              {order.total !== null ? `₹${order.total.toFixed(2)}` : "Not billed"}
            </div>
          </Card>
        ))}
        {orderRows.length === 0 && <p className="font-sans text-sm text-muted">No orders yet.</p>}
      </div>

      <div className="flex flex-col gap-2">
        <div className="px-0.5 font-sans text-[11px] font-bold uppercase tracking-wide text-muted">Ledger history</div>
        {(ledgerEntries ?? []).map((entry) => (
          <Card key={entry.id} elevated className="flex items-center justify-between !space-y-0">
            <div>
              <div className="flex items-center gap-2">
                <Badge tone={entry.entry_type === "debit" ? "danger" : "success"} size="sm">
                  {entry.entry_type}
                </Badge>
                <span className="font-sans text-[11.5px] font-medium text-muted">
                  {formatIstDisplay(new Date(entry.created_at))}
                </span>
              </div>
              {entry.note && <div className="mt-1 font-sans text-xs text-muted">{entry.note}</div>}
            </div>
            <div className="text-right">
              <div className="font-display text-sm font-bold text-foreground">₹{entry.amount.toFixed(2)}</div>
              {entry.mode && <div className="font-sans text-[11px] text-muted">{entry.mode}</div>}
            </div>
          </Card>
        ))}
        {(ledgerEntries ?? []).length === 0 && <p className="font-sans text-sm text-muted">No ledger activity yet.</p>}
      </div>
    </div>
  );
}
