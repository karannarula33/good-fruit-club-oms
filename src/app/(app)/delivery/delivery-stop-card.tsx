"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { PhoneCall, MapPin, CheckCircle2, Clock } from "lucide-react";
import { deliverOrder } from "@/app/actions/delivery";
import { toE164 } from "@/lib/phone";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/ui/form-error";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { DISPLAY_STATUS_LABEL, deriveDisplayStatus, displayStatusChipStyle } from "@/lib/orders/status-display";
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

const SWIPE_THRESHOLD = 90;

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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [amount, setAmount] = useState(stop.netDue !== null ? String(stop.netDue) : "");
  const [mode, setMode] = useState<LedgerMode>("cash");

  const x = useMotionValue(0);
  const deliverOpacity = useTransform(x, [20, SWIPE_THRESHOLD], [0, 1]);
  const skipOpacity = useTransform(x, [-SWIPE_THRESHOLD, -20], [1, 0]);

  function handleConfirmDelivered() {
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
      setSheetOpen(false);
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
      setSheetOpen(false);
      router.refresh();
    });
  }

  function handleSwipeEnd(_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    if (pending) return;
    if (info.offset.x > SWIPE_THRESHOLD) {
      setSheetOpen(true);
    } else if (info.offset.x < -SWIPE_THRESHOLD) {
      handleSkipPayment();
    }
  }

  const displayStatus = deriveDisplayStatus(stop.status, false);

  const cardContent = (
    <Card elevated>
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
            <h2 className="font-display text-[15px] font-bold text-foreground">{stop.customerName}</h2>
            <p className="mt-0.5 flex items-center gap-1 font-sans text-[12.5px] font-medium text-muted">
              <MapPin className="size-3.5" aria-hidden="true" />
              {stop.zone} · {stop.address}
            </p>
          </div>
        </div>
        <Badge style={displayStatusChipStyle(displayStatus)} size="sm" className="shrink-0">
          {DISPLAY_STATUS_LABEL[displayStatus]}
        </Badge>
      </div>

      <div className="flex items-center justify-between gap-3">
        {stop.phone ? (
          <a
            href={`tel:${toE164(stop.phone)}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-info-bg px-3.5 py-2 font-sans text-[13px] font-bold text-info-text"
          >
            <PhoneCall className="size-4" aria-hidden="true" />
            Call
          </a>
        ) : (
          <span className="font-sans text-sm text-muted">No phone on file</span>
        )}
        <div className="font-display text-base font-bold text-foreground">
          {stop.netDue !== null ? `₹${stop.netDue.toFixed(2)}` : "—"}
        </div>
      </div>

      {stop.billTotal === null && <FormError>Not billed yet</FormError>}
      {error && <FormError>{error}</FormError>}

      {stop.status === "out_for_delivery" && (
        <div className="flex gap-2">
          <Button variant="primary" fullWidth onClick={() => setSheetOpen(true)}>
            Mark Delivered
          </Button>
          <Button variant="secondary" onClick={handleSkipPayment} disabled={pending}>
            Skip
          </Button>
        </div>
      )}
    </Card>
  );

  return (
    <>
      {stop.status !== "out_for_delivery" ? (
        cardContent
      ) : (
        <div className="relative">
          <motion.div
            style={{ opacity: deliverOpacity }}
            className="pointer-events-none absolute inset-0 flex items-center rounded-[20px] bg-success-bg pl-4 text-success-text"
            aria-hidden="true"
          >
            <CheckCircle2 className="size-6" />
          </motion.div>
          <motion.div
            style={{ opacity: skipOpacity }}
            className="pointer-events-none absolute inset-0 flex items-center justify-end rounded-[20px] bg-warning-bg pr-4 text-warning-text"
            aria-hidden="true"
          >
            <Clock className="size-6" />
          </motion.div>
          <motion.div
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.4}
            onDragEnd={handleSwipeEnd}
            style={{ x }}
            className="relative"
          >
            {cardContent}
          </motion.div>
        </div>
      )}

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <div className="space-y-3">
          <div>
            <div className="mb-0.5 font-display text-base font-bold text-foreground">Payment Collected</div>
            <div className="font-sans text-[12.5px] font-medium text-muted">{stop.customerName}</div>
          </div>
          <Input
            size="lg"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount (₹)"
            className="w-full text-center"
          />
          <Select value={mode} onChange={(e) => setMode(e.target.value as LedgerMode)} className="w-full">
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="other">Other</option>
          </Select>
          {error && <FormError>{error}</FormError>}
          <Button variant="dark" fullWidth onClick={handleConfirmDelivered} pending={pending} pendingText="Saving…">
            Confirm Delivered
          </Button>
          <Button variant="secondary" fullWidth onClick={handleSkipPayment} disabled={pending}>
            Skip (pay later)
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}
