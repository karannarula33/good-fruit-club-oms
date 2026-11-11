"use client";

// Manage Orders extras (admin, 2026-11-11): an order's discount (₹ or %,
// with a reason) and "Duplicate order" -- a second identical order for the
// same customer that day.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Percent } from "lucide-react";
import { setOrderDiscount, type BillEditResult } from "@/app/actions/bill-edit";
import { duplicateOrder } from "@/app/actions/manage-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-error";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { describeDiscount } from "@/lib/billing/discount";
import type { DiscountType } from "@/lib/supabase/database.types";

export interface OrderDiscountInfo {
  type: DiscountType;
  value: number;
  reason: string | null;
}

export function DiscountEditor({
  orderId,
  discount,
  billDiscount,
  billed,
  disabled,
  onBill,
}: {
  orderId: string;
  discount: OrderDiscountInfo | null;
  billDiscount: number; // rupees off the current bill
  billed: boolean;
  disabled: boolean;
  onBill: (bill: Extract<BillEditResult, { ok: true }>) => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<DiscountType>(discount?.type ?? "amount");
  const [value, setValue] = useState(discount ? String(discount.value) : "");
  const [reason, setReason] = useState(discount?.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(input: { type: DiscountType; value: number; reason: string } | null) {
    setError(null);
    startTransition(async () => {
      const r = await setOrderDiscount(orderId, input);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      if (r.bill) {
        onBill(r.bill);
        showToast(`${input ? "Discount saved" : "Discount removed"} — bill updated to ₹${r.bill.total} ✓`);
      } else {
        showToast(input ? "Discount saved — it'll apply when the bill is made ✓" : "Discount removed ✓");
      }
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-neutral-bg px-3.5 py-3">
        <Percent className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <div className="min-w-0 flex-1 font-sans text-[12.5px]">
          {discount ? (
            <>
              <div className="font-bold text-foreground">
                {describeDiscount(discount)}
                {billed && billDiscount > 0 && <span className="ml-1 font-semibold text-muted">(−₹{billDiscount} on the bill)</span>}
              </div>
              {discount.reason && <div className="font-semibold text-muted">{discount.reason}</div>}
            </>
          ) : (
            <span className="font-semibold text-muted">No discount</span>
          )}
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="font-sans text-[12.5px] font-bold text-brand disabled:opacity-40"
        >
          {discount ? "Change" : "Add discount"}
        </button>
      </div>
    );
  }

  const n = Number(value);
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-neutral-bg px-3.5 py-3">
      <div className="flex items-center gap-2">
        <div className="flex overflow-hidden rounded-xl border border-neutral-300 dark:border-neutral-700">
          {(["amount", "percent"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={cn(
                "px-3 py-1.5 font-sans text-[12.5px] font-bold",
                type === t ? "bg-foreground text-white" : "bg-white text-foreground dark:bg-neutral-900",
              )}
            >
              {t === "amount" ? "₹" : "%"}
            </button>
          ))}
        </div>
        <Input
          size="sm"
          type="number"
          inputMode="decimal"
          min={0}
          max={type === "percent" ? 100 : undefined}
          placeholder={type === "amount" ? "Amount" : "Percent"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-28"
          aria-label="Discount"
        />
      </div>
      <Input
        size="sm"
        placeholder="Reason (e.g. regular member, delay last order)"
        value={reason}
        maxLength={200}
        onChange={(e) => setReason(e.target.value)}
        aria-label="Reason for the discount"
      />
      {billed && (
        <div className="font-sans text-[11.5px] font-semibold text-muted">
          Saving updates the bill, the balance and the payment link — send the updated bill after.
        </div>
      )}
      {error && <FormError>{error}</FormError>}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          pending={pending}
          disabled={!(n > 0) || reason.trim().length < 3}
          onClick={() => save({ type, value: n, reason })}
        >
          Save discount
        </Button>
        {discount && (
          <Button size="sm" variant="destructive" disabled={pending} onClick={() => save(null)}>
            Remove
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function DuplicateOrderButton({ orderId, customerName, onDone }: { orderId: string; customerName: string; onDone: () => void }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      {confirm ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-neutral-bg px-3.5 py-3">
          <div className="font-sans text-[12.5px] font-semibold text-foreground">
            Add a second, identical order for {customerName} on this day? It goes to packing as a separate order with
            its own bill.
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              pending={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const r = await duplicateOrder(orderId);
                  if (!r.ok) {
                    setError(r.error);
                    return;
                  }
                  setConfirm(false);
                  showToast("Order duplicated ✓");
                  onDone();
                  router.refresh();
                })
              }
            >
              Yes, duplicate
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" fullWidth onClick={() => setConfirm(true)}>
          <Copy className="size-4" aria-hidden="true" />
          Duplicate order
        </Button>
      )}
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
