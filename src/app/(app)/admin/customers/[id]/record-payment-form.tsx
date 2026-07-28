"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordPayment } from "@/app/actions/ledger";
import type { LedgerMode } from "@/lib/supabase/database.types";

interface OutstandingOrder {
  id: string;
  deliveryDate: string;
  remainingDue: number;
}

export function RecordPaymentForm({
  customerId,
  outstandingOrders,
}: {
  customerId: string;
  outstandingOrders: OutstandingOrder[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<LedgerMode>("cash");
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, string>>({});

  const amountNumber = Number(amount);
  const validAmount = Number.isFinite(amountNumber) && amountNumber > 0;

  const allocatedTotal = useMemo(() => {
    return outstandingOrders.reduce((sum, order) => {
      if (!checked[order.id]) return sum;
      const raw = allocationAmounts[order.id];
      const value = raw !== undefined ? Number(raw) : order.remainingDue;
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
  }, [outstandingOrders, checked, allocationAmounts]);

  const remainder = validAmount ? Math.round((amountNumber - allocatedTotal) * 100) / 100 : 0;

  function toggleOrder(order: OutstandingOrder, isChecked: boolean) {
    setChecked((prev) => ({ ...prev, [order.id]: isChecked }));
    if (isChecked && allocationAmounts[order.id] === undefined) {
      const cap = validAmount ? Math.min(order.remainingDue, amountNumber) : order.remainingDue;
      setAllocationAmounts((prev) => ({ ...prev, [order.id]: String(cap) }));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!validAmount) {
      setError("Enter a payment amount greater than zero.");
      return;
    }

    const allocations = outstandingOrders
      .filter((order) => checked[order.id])
      .map((order) => ({
        orderId: order.id,
        amount: Number(allocationAmounts[order.id] ?? order.remainingDue),
      }));

    for (const allocation of allocations) {
      if (!Number.isFinite(allocation.amount) || allocation.amount <= 0) {
        setError("Every checked order needs an allocation amount greater than zero.");
        return;
      }
    }

    startTransition(async () => {
      const result = await recordPayment({
        customerId,
        amount: amountNumber,
        mode,
        note: note.trim() || null,
        allocations,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAmount("");
      setNote("");
      setChecked({});
      setAllocationAmounts({});
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border border-neutral-300 rounded-md p-4">
      <h2 className="text-lg font-semibold">Record payment</h2>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col text-sm">
          Amount (₹)
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="border border-neutral-300 rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col text-sm">
          Mode
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as LedgerMode)}
            className="border border-neutral-300 rounded px-2 py-1"
          >
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="flex flex-col text-sm flex-1 min-w-[10rem]">
          Note
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="border border-neutral-300 rounded px-2 py-1"
          />
        </label>
      </div>

      {outstandingOrders.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm text-neutral-600">
            Allocate to outstanding orders (leave unchecked to record as an advance):
          </p>
          {outstandingOrders.map((order) => (
            <div key={order.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!checked[order.id]}
                onChange={(e) => toggleOrder(order, e.target.checked)}
              />
              <span className="w-28">{order.deliveryDate}</span>
              <span className="text-neutral-600 w-32">Due ₹{order.remainingDue.toFixed(2)}</span>
              {checked[order.id] && (
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={allocationAmounts[order.id] ?? String(order.remainingDue)}
                  onChange={(e) =>
                    setAllocationAmounts((prev) => ({ ...prev, [order.id]: e.target.value }))
                  }
                  className="border border-neutral-300 rounded px-2 py-1 w-24"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {validAmount && (
        <p className="text-sm text-neutral-600">
          {remainder > 0
            ? `₹${remainder.toFixed(2)} will be recorded as an advance.`
            : remainder < 0
              ? `Allocated amount exceeds the payment by ₹${Math.abs(remainder).toFixed(2)} — reduce an allocation.`
              : "Fully allocated."}
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={isPending || !validAmount || remainder < 0}
        className="bg-neutral-900 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
      >
        {isPending ? "Recording…" : "Record payment"}
      </button>
    </form>
  );
}
