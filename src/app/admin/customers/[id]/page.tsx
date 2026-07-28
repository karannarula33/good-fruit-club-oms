import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { computeCustomerBalance, derivePaymentStatus } from "@/lib/billing/compute";
import { formatIstDisplay } from "@/lib/time/ist";
import { RecordPaymentForm } from "./record-payment-form";

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
      <div>
        <Link href="/admin/customers" className="text-sm underline text-neutral-500">
          ← Customers
        </Link>
        <h1 className="text-xl font-semibold">{customer.display_name}</h1>
        <p className="text-neutral-600">
          {customer.phone ?? "No phone"} · {customer.address} · {customer.zone}
        </p>
        <p className="text-lg font-medium mt-2">
          Balance:{" "}
          {balance > 0 ? (
            <span className="text-red-600">₹{balance.toFixed(2)} owed</span>
          ) : balance < 0 ? (
            <span className="text-green-700">₹{Math.abs(balance).toFixed(2)} advance</span>
          ) : (
            <span className="text-neutral-600">₹0</span>
          )}
        </p>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Orders</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border border-neutral-300 rounded-md">
            <thead>
              <tr className="bg-neutral-100 text-left">
                <th className="px-3 py-2">Delivery date</th>
                <th className="px-3 py-2">Order status</th>
                <th className="px-3 py-2">Bill total</th>
                <th className="px-3 py-2">Paid</th>
                <th className="px-3 py-2">Remaining due</th>
                <th className="px-3 py-2">Payment status</th>
              </tr>
            </thead>
            <tbody>
              {orderRows.map((order) => (
                <tr key={order.id} className="border-t border-neutral-200">
                  <td className="px-3 py-2">{order.deliveryDate}</td>
                  <td className="px-3 py-2 text-neutral-600">{order.status}</td>
                  <td className="px-3 py-2">{order.total !== null ? `₹${order.total.toFixed(2)}` : "Not billed"}</td>
                  <td className="px-3 py-2">{order.total !== null ? `₹${order.allocated.toFixed(2)}` : "—"}</td>
                  <td className="px-3 py-2">
                    {order.remainingDue !== null ? `₹${order.remainingDue.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {order.paymentStatus && (
                      <span
                        className={
                          order.paymentStatus === "paid"
                            ? "text-green-700"
                            : order.paymentStatus === "partial"
                              ? "text-amber-600"
                              : "text-red-600"
                        }
                      >
                        {order.paymentStatus}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <RecordPaymentForm customerId={customer.id} outstandingOrders={outstandingOrders} />

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Ledger history</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border border-neutral-300 rounded-md">
            <thead>
              <tr className="bg-neutral-100 text-left">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Mode</th>
                <th className="px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {(ledgerEntries ?? []).map((entry) => (
                <tr key={entry.id} className="border-t border-neutral-200">
                  <td className="px-3 py-2 text-neutral-600">{formatIstDisplay(new Date(entry.created_at))}</td>
                  <td className="px-3 py-2">
                    <span className={entry.entry_type === "debit" ? "text-red-600" : "text-green-700"}>
                      {entry.entry_type}
                    </span>
                  </td>
                  <td className="px-3 py-2">₹{entry.amount.toFixed(2)}</td>
                  <td className="px-3 py-2 text-neutral-600">{entry.mode ?? "—"}</td>
                  <td className="px-3 py-2 text-neutral-600">{entry.note ?? "—"}</td>
                </tr>
              ))}
              {(ledgerEntries ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-2 text-neutral-500">
                    No ledger activity yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
