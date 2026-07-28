"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PhoneCall, MapPin } from "lucide-react";
import { deliverOrder } from "@/app/actions/delivery";
import { toE164 } from "@/lib/phone";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/ui/form-error";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from "@/lib/orders/status-display";
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

export function DeliveryStopCard({
  stop,
  selectable = false,
  checked = false,
  onToggle,
  onOptimisticDeliver,
}: {
  stop: Stop;
  selectable?: boolean;
  checked?: boolean;
  onToggle?: (checked: boolean) => void;
  onOptimisticDeliver?: () => void;
}) {
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
      onOptimisticDeliver?.();
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
      onOptimisticDeliver?.();
      const result = await deliverOrder(stop.id, null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          {selectable && (
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => onToggle?.(e.target.checked)}
              className="mt-1.5 size-4"
            />
          )}
          <div>
            <h2 className="text-lg font-semibold">{stop.customerName}</h2>
            <p className="flex items-center gap-1 text-sm text-neutral-600 dark:text-neutral-400">
              <MapPin className="size-3.5" aria-hidden="true" />
              {stop.zone} · {stop.address}
            </p>
          </div>
        </div>
        <Badge tone={ORDER_STATUS_TONE[stop.status]} size="sm" className="shrink-0">
          {ORDER_STATUS_LABEL[stop.status]}
        </Badge>
      </div>

      <div className="flex items-center gap-3 text-sm">
        {stop.phone ? (
          <a
            href={`tel:${toE164(stop.phone)}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-neutral-bg px-3 py-2 font-medium"
          >
            <PhoneCall className="size-4" aria-hidden="true" />
            {stop.phone}
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
          <FormError>Not billed yet</FormError>
        )}
      </div>

      {error && <FormError>{error}</FormError>}

      {stop.status === "out_for_delivery" && (
        <div className="space-y-2 border-t border-neutral-200 dark:border-neutral-800 pt-3">
          <div className="flex gap-2">
            <Input
              size="lg"
              className="flex-1"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount collected"
            />
            <Select value={mode} onChange={(e) => setMode(e.target.value as LedgerMode)}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="other">Other</option>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" size="lg" fullWidth onClick={handleMarkDelivered} pending={pending} pendingText="Saving…">
              Mark delivered
            </Button>
            <Button variant="secondary" size="lg" onClick={handleSkipPayment} disabled={pending}>
              Skip (pay later)
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
