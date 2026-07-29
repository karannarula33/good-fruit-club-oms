"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteOrder, deleteOrderLine } from "@/app/actions/manage-orders";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { FormError } from "@/components/ui/form-error";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { deriveDisplayStatus, displayStatusChipStyle, DISPLAY_STATUS_LABEL } from "@/lib/orders/status-display";
import type { OrderStatus } from "@/lib/supabase/database.types";

export interface ManageOrderLine {
  id: string;
  productName: string;
  unitLabel: string | null;
  orderedQty: number | null;
  orderedUnit: string | null;
}

export interface ManageOrderRow {
  id: string;
  customerName: string;
  status: OrderStatus;
  hasBill: boolean;
  billTotal: number | null;
  lines: ManageOrderLine[];
}

const CONFIRM_WINDOW_MS = 3000;

export function ManageOrdersList({ rows }: { rows: ManageOrderRow[] }) {
  const router = useRouter();
  const { showToast } = useToast();

  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null); // "order" | lineId | null
  const [deletingKey, setDeletingKey] = useState<string | null>(null); // "order" | lineId | null, while in flight
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openOrder = rows.find((r) => r.id === openOrderId) ?? null;

  function armConfirm(key: string) {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirming(key);
    confirmTimer.current = setTimeout(() => setConfirming(null), CONFIRM_WINDOW_MS);
  }

  function closeSheet() {
    setOpenOrderId(null);
    setConfirming(null);
    setError(null);
  }

  function handleDeleteLine(orderId: string, lineId: string) {
    if (confirming !== lineId) {
      armConfirm(lineId);
      return;
    }
    setConfirming(null);
    setError(null);
    setDeletingKey(lineId);
    startTransition(async () => {
      const result = await deleteOrderLine(orderId, lineId);
      setDeletingKey(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      showToast("Line deleted ✓");
      router.refresh();
    });
  }

  function handleDeleteOrder(orderId: string) {
    if (confirming !== "order") {
      armConfirm("order");
      return;
    }
    setConfirming(null);
    setError(null);
    setDeletingKey("order");
    startTransition(async () => {
      const result = await deleteOrder(orderId);
      setDeletingKey(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      showToast("Order deleted ✓");
      closeSheet();
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return <p className="font-sans text-sm text-muted">No orders for this date.</p>;
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {rows.map((row) => {
          const displayStatus = deriveDisplayStatus(row.status, row.hasBill);
          return (
            <Card
              key={row.id}
              elevated
              className="flex items-center gap-3 !space-y-0"
              onClick={() => setOpenOrderId(row.id)}
            >
              <div className="min-w-0 flex-1">
                <div className="font-sans text-sm font-bold text-foreground">{row.customerName}</div>
                <div className="font-sans text-[11.5px] font-semibold text-muted">
                  {row.lines.length} item{row.lines.length === 1 ? "" : "s"}
                </div>
              </div>
              <Badge size="sm" style={displayStatusChipStyle(displayStatus)}>
                {DISPLAY_STATUS_LABEL[displayStatus]}
              </Badge>
              <div className="font-display text-sm font-bold text-foreground">
                {row.billTotal !== null ? `₹${row.billTotal.toFixed(2)}` : "Not billed"}
              </div>
            </Card>
          );
        })}
      </div>

      <BottomSheet open={openOrder !== null} onClose={closeSheet}>
        {openOrder && (
          <div className="flex max-h-[75vh] flex-col gap-3 overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="font-display text-base font-bold text-foreground">{openOrder.customerName}</div>
              <Badge size="sm" style={displayStatusChipStyle(deriveDisplayStatus(openOrder.status, openOrder.hasBill))}>
                {DISPLAY_STATUS_LABEL[deriveDisplayStatus(openOrder.status, openOrder.hasBill)]}
              </Badge>
            </div>

            {openOrder.hasBill && (
              <FormError>Already billed — can&apos;t be edited or deleted.</FormError>
            )}

            <div className="flex flex-col gap-2">
              {openOrder.lines.map((line) => (
                <div key={line.id} className="flex items-center gap-3 rounded-2xl bg-neutral-bg px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-sans text-sm font-bold text-foreground">{line.productName}</div>
                    <div className="font-sans text-[11.5px] font-semibold text-muted">
                      {line.orderedQty} {line.orderedUnit ?? line.unitLabel ?? ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={openOrder.hasBill || deletingKey !== null}
                    onClick={() => handleDeleteLine(openOrder.id, line.id)}
                    className={cn(
                      "shrink-0 rounded-full p-2 disabled:opacity-40",
                      confirming === line.id ? "bg-danger-bg text-danger-text" : "text-muted hover:bg-white",
                    )}
                  >
                    {confirming === line.id ? (
                      <span className="px-1 font-sans text-[11px] font-bold whitespace-nowrap">Confirm?</span>
                    ) : (
                      <Trash2 className="size-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              ))}
              {openOrder.lines.length === 0 && (
                <p className="font-sans text-sm text-muted">No line items left on this order.</p>
              )}
            </div>

            {error && <FormError>{error}</FormError>}

            <Button
              variant="destructive"
              fullWidth
              disabled={openOrder.hasBill || deletingKey !== null}
              pending={deletingKey === "order"}
              onClick={() => handleDeleteOrder(openOrder.id)}
            >
              {confirming === "order" ? "Tap again to confirm delete" : "Delete order"}
            </Button>
          </div>
        )}
      </BottomSheet>
    </>
  );
}
