"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordPayment } from "@/app/actions/ledger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/ui/form-error";
import { BottomSheet } from "@/components/ui/bottom-sheet";
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
  const [open, setOpen] = useState(false);
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
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="primary" fullWidth onClick={() => setOpen(true)}>
        Record Payment
      </Button>

      <BottomSheet open={open} onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="mb-0.5 font-display text-base font-bold text-foreground">Record Payment</div>

          <label className="flex flex-col gap-1 font-sans text-sm font-semibold text-muted">
            Amount (₹)
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              size="lg"
              className="w-full text-center"
            />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1 font-sans text-sm font-semibold text-muted">
              Mode
              <Select value={mode} onChange={(e) => setMode(e.target.value as LedgerMode)} className="w-full">
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="other">Other</option>
              </Select>
            </label>
            <label className="flex flex-1 flex-col gap-1 font-sans text-sm font-semibold text-muted">
              Note
              <Input type="text" value={note} onChange={(e) => setNote(e.target.value)} className="w-full" />
            </label>
          </div>

          {outstandingOrders.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-sans text-xs font-semibold text-muted">
                Allocate to outstanding orders (leave unchecked to record as an advance):
              </p>
              {outstandingOrders.map((order) => (
                <div key={order.id} className="flex items-center gap-2 font-sans text-sm">
                  <input
                    type="checkbox"
                    checked={!!checked[order.id]}
                    onChange={(e) => toggleOrder(order, e.target.checked)}
                  />
                  <span className="w-28">{order.deliveryDate}</span>
                  <span className="w-32 text-muted">Due ₹{order.remainingDue.toFixed(2)}</span>
                  {checked[order.id] && (
                    <Input
                      className="w-24"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={allocationAmounts[order.id] ?? String(order.remainingDue)}
                      onChange={(e) => setAllocationAmounts((prev) => ({ ...prev, [order.id]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {validAmount && (
            <p className="font-sans text-xs font-semibold text-muted">
              {remainder > 0
                ? `₹${remainder.toFixed(2)} will be recorded as an advance.`
                : remainder < 0
                  ? `Allocated amount exceeds the payment by ₹${Math.abs(remainder).toFixed(2)} — reduce an allocation.`
                  : "Fully allocated."}
            </p>
          )}

          {error && <FormError>{error}</FormError>}

          <Button type="submit" variant="dark" fullWidth disabled={!validAmount || remainder < 0} pending={isPending} pendingText="Recording…">
            Save Payment
          </Button>
        </form>
      </BottomSheet>
    </>
  );
}
