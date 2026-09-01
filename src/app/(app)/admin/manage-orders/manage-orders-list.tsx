"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { addOrderLine, deleteOrder, deleteOrderLine, updateOrderLineQty } from "@/app/actions/manage-orders";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { FormError } from "@/components/ui/form-error";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  deriveDisplayStatus,
  displayStatusChipStyle,
  DISPLAY_STATUS_LABEL,
  ORDER_STATUS_LABEL,
} from "@/lib/orders/status-display";
import type { LineStatus, OrderStatus, UnitType } from "@/lib/supabase/database.types";

export interface ManageOrderLine {
  id: string;
  productName: string;
  unitLabel: string | null;
  orderedQty: number | null;
  orderedUnit: string | null;
  actualQty: number | null;
  lineStatus: LineStatus;
}

export interface ManageOrderRow {
  id: string;
  customerName: string;
  status: OrderStatus;
  hasBill: boolean;
  billTotal: number | null;
  editable: boolean;
  lines: ManageOrderLine[];
  packagingSummary: string | null;
}

export interface ProductOption {
  id: string;
  name: string;
  unitType: UnitType;
  unitLabel: string | null;
}

const CONFIRM_WINDOW_MS = 3000;

function stepFor(unitType: UnitType | undefined): number {
  return unitType === "weight" ? 0.5 : 1;
}

// Once a line has been resolved at packing, its ordered_qty is history --
// display whichever qty billing will actually read (see
// src/lib/orders/edit-order.ts).
function displayQty(line: ManageOrderLine): number | null {
  return line.lineStatus === "packed" ? (line.actualQty ?? line.orderedQty) : line.orderedQty;
}

export function ManageOrdersList({ rows, products }: { rows: ManageOrderRow[]; products: ProductOption[] }) {
  const router = useRouter();
  const { showToast } = useToast();

  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null); // "order" | lineId | null
  const [deletingKey, setDeletingKey] = useState<string | null>(null); // "order" | lineId | null, while in flight
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editingQty, setEditingQty] = useState("");
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  // Optimistic display of a just-saved qty, since these rows are server-fetched props.
  const [qtyOverrideByLineId, setQtyOverrideByLineId] = useState<Map<string, number>>(new Map());

  const [addingLine, setAddingLine] = useState(false);
  const [newProductId, setNewProductId] = useState("");
  const [newQty, setNewQty] = useState("");
  const [addSaving, setAddSaving] = useState(false);

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
    setEditingLineId(null);
    setAddingLine(false);
    setNewProductId("");
    setNewQty("");
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

  function startEditQty(line: ManageOrderLine, currentQty: number | null) {
    setEditingLineId(line.id);
    setEditingQty(currentQty !== null ? String(currentQty) : "");
    setError(null);
  }

  function cancelEditQty() {
    setEditingLineId(null);
    setEditingQty("");
  }

  function handleSaveQty(orderId: string, lineId: string) {
    const qty = Number(editingQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Enter a quantity greater than zero.");
      return;
    }
    setError(null);
    setSavingLineId(lineId);
    startTransition(async () => {
      const result = await updateOrderLineQty(orderId, lineId, qty);
      setSavingLineId(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setQtyOverrideByLineId((prev) => new Map(prev).set(lineId, qty));
      setEditingLineId(null);
      showToast("Quantity updated ✓");
      router.refresh();
    });
  }

  function handleAddLine(orderId: string) {
    const qty = Number(newQty);
    if (!newProductId) {
      setError("Pick a product.");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Enter a quantity greater than zero.");
      return;
    }
    const product = products.find((p) => p.id === newProductId);
    setError(null);
    setAddSaving(true);
    startTransition(async () => {
      const result = await addOrderLine(orderId, newProductId, qty, product?.unitLabel ?? null);
      setAddSaving(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAddingLine(false);
      setNewProductId("");
      setNewQty("");
      showToast("Item added ✓");
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
                {row.packagingSummary && (
                  <div className="font-sans text-[11px] font-semibold text-tertiary">{row.packagingSummary}</div>
                )}
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

            {openOrder.packagingSummary && (
              <div className="font-sans text-[12.5px] font-semibold text-tertiary">{openOrder.packagingSummary}</div>
            )}

            {!openOrder.editable && (
              <FormError>
                {openOrder.hasBill
                  ? "Already billed — can't be edited or deleted."
                  : `${ORDER_STATUS_LABEL[openOrder.status]} — can't be edited or deleted.`}
              </FormError>
            )}

            <div className="flex flex-col gap-2">
              {openOrder.lines.map((line) => {
                const qty = qtyOverrideByLineId.get(line.id) ?? displayQty(line);
                const isEditing = editingLineId === line.id;
                const product = products.find((p) => p.name === line.productName);
                return (
                  <div key={line.id} className="flex items-center gap-3 rounded-2xl bg-neutral-bg px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-sans text-sm font-bold text-foreground">{line.productName}</div>
                      {isEditing ? (
                        <div className="mt-1 flex items-center gap-1.5">
                          <Input
                            size="sm"
                            type="number"
                            inputMode="decimal"
                            step={stepFor(product?.unitType)}
                            min={0}
                            autoFocus
                            value={editingQty}
                            onChange={(e) => setEditingQty(e.target.value)}
                            className="w-20"
                          />
                          <span className="font-sans text-[11.5px] font-semibold text-muted">
                            {line.orderedUnit ?? line.unitLabel ?? ""}
                          </span>
                        </div>
                      ) : (
                        <div className="font-sans text-[11.5px] font-semibold text-muted">
                          {qty} {line.orderedUnit ?? line.unitLabel ?? ""}
                          {line.lineStatus === "packed" && <span className="ml-1 text-tertiary">(packed)</span>}
                        </div>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          disabled={savingLineId !== null}
                          onClick={() => handleSaveQty(openOrder.id, line.id)}
                          className="rounded-full p-2 text-success-text hover:bg-white disabled:opacity-40"
                        >
                          <Check className="size-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          disabled={savingLineId !== null}
                          onClick={cancelEditQty}
                          className="rounded-full p-2 text-muted hover:bg-white disabled:opacity-40"
                        >
                          <X className="size-4" aria-hidden="true" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          disabled={!openOrder.editable || deletingKey !== null}
                          onClick={() => startEditQty(line, qty)}
                          className="rounded-full p-2 text-muted hover:bg-white disabled:opacity-40"
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          disabled={!openOrder.editable || deletingKey !== null}
                          onClick={() => handleDeleteLine(openOrder.id, line.id)}
                          className={cn(
                            "rounded-full p-2 disabled:opacity-40",
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
                    )}
                  </div>
                );
              })}
              {openOrder.lines.length === 0 && (
                <p className="font-sans text-sm text-muted">No line items left on this order.</p>
              )}
            </div>

            {addingLine ? (
              <div className="flex flex-col gap-2 rounded-2xl bg-neutral-bg px-3.5 py-3">
                <Select
                  size="sm"
                  value={newProductId}
                  onChange={(e) => setNewProductId(e.target.value)}
                >
                  <option value="">Pick a product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <div className="flex items-center gap-1.5">
                  <Input
                    size="sm"
                    type="number"
                    inputMode="decimal"
                    step={stepFor(products.find((p) => p.id === newProductId)?.unitType)}
                    min={0}
                    placeholder="Qty"
                    value={newQty}
                    onChange={(e) => setNewQty(e.target.value)}
                    className="w-20"
                  />
                  <span className="font-sans text-[11.5px] font-semibold text-muted">
                    {products.find((p) => p.id === newProductId)?.unitLabel ?? ""}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" pending={addSaving} onClick={() => handleAddLine(openOrder.id)}>
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={addSaving}
                    onClick={() => {
                      setAddingLine(false);
                      setNewProductId("");
                      setNewQty("");
                      setError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={!openOrder.editable}
                onClick={() => setAddingLine(true)}
                className="flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-neutral-300 py-2.5 font-sans text-[12.5px] font-bold text-muted disabled:opacity-40 dark:border-neutral-700"
              >
                <Plus className="size-4" aria-hidden="true" />
                Add item
              </button>
            )}

            {error && <FormError>{error}</FormError>}

            <Button
              variant="destructive"
              fullWidth
              disabled={!openOrder.editable || deletingKey !== null}
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
