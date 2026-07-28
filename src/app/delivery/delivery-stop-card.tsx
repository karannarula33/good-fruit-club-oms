"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deliverOrder } from "@/app/actions/delivery";
import { toE164 } from "@/lib/phone";
import type { LedgerMode, OrderStatus } from "@/lib/supabase/database.types";

interface Stop {
  id: string;
  status: OrderStatus;
  customerName: string;
  phone: string | null;
  address: string;
  zone: string;
  billTotal: number | null;
  netDue: number | null;
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  recorded: "Recorded",
  packed: "Packed",
  dispatched: "Dispatched",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export function DeliveryStopCard({ stop }: { stop: Stop }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(stop.netDue !== null ? String(stop.netDue) : "");
  const [mode, setMode] = useState<LedgerMode>("cash");

  function handleMarkDelivered() {
    setError(null);
    const amountNumber = Number(amount);
    const payment = amountNumber > 0 ? { amount: amountNumber, mode } : null;
    startTransition(async () => {
      const result = await deliverOrder(stop.id, payment);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleSkipPayment() {
    setError(null);
    startTransition(async () => {
      const result = await deliverOrder(stop.id, null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-neutral-300 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{stop.customerName}</h2>
          <p className="text-sm text-neutral-600">{stop.zone}</p>
          <p className="text-sm text-neutral-600">{stop.address}</p>
        </div>
        <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-700">
          {STATUS_LABEL[stop.status]}
        </span>
      </div>

      <div className="flex items-center gap-3 text-sm">
        {stop.phone ? (
          <a href={`tel:${toE164(stop.phone)}`} className="rounded-md bg-neutral-100 px-3 py-2 font-medium">
            Call {stop.phone}
          </a>
        ) : (
          <span className="text-neutral-500">No phone on file</span>
        )}
      </div>

      <div className="text-sm">
        {stop.billTotal !== null ? (
          <p>
            Bill: ₹{stop.billTotal.toFixed(2)} · Net due: ₹{(stop.netDue ?? 0).toFixed(2)}
          </p>
        ) : (
          <p className="text-red-600">Not billed yet</p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {stop.status === "out_for_delivery" && (
        <div className="space-y-2 border-t border-neutral-200 pt-3">
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount collected"
              className="flex-1 rounded-md border border-neutral-300 px-3 py-3 text-lg"
            />
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as LedgerMode)}
              className="rounded-md border border-neutral-300 px-2 py-2 text-sm"
            >
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleMarkDelivered}
              disabled={pending}
              className="flex-1 rounded-md bg-neutral-900 px-4 py-3 text-lg text-white disabled:opacity-50"
            >
              {pending ? "Saving…" : "Mark delivered"}
            </button>
            <button
              type="button"
              onClick={handleSkipPayment}
              disabled={pending}
              className="rounded-md bg-neutral-100 px-4 py-3 text-sm text-neutral-700 disabled:opacity-50"
            >
              Skip (pay later)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
