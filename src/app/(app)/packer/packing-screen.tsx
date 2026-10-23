"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { ChevronLeft, PackageCheck, Ban, MessageCircle, XCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { finalizeOrder } from "@/app/actions/packing";
import { generateBill, overrideLinePrice, overrideLineQuantity } from "@/app/actions/bills";
import { addPackedLine, removePackedLine } from "@/app/actions/packed-edit";
import { updateCustomerSalutation } from "@/app/actions/customers";
import { toWhatsAppDigits } from "@/lib/phone";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FormError } from "@/components/ui/form-error";
import { useToast } from "@/components/ui/toast";
import { deriveDisplayStatus, displayStatusChipStyle, DISPLAY_STATUS_LABEL } from "@/lib/orders/status-display";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { cn } from "@/lib/cn";
import { PACKAGING_TYPES, PACKAGING_LABEL, summarizePackaging } from "@/lib/packing/packaging";
import type { OrderStatus, UnitType, PackagingType } from "@/lib/supabase/database.types";

export interface PackingLine {
  id: string;
  productId: string;
  productName: string;
  unitType: UnitType;
  unitLabel: string | null;
  orderedQty: number | null;
  orderedUnit: string | null;
  actualQty: number | null; // packed (COGS)
  billedQty: number | null; // billed to the customer; null = same as packed
  lockedPricePerUnit: number | null;
  lineStatus: "pending" | "packed" | "unavailable";
  packageId: string | null;
}

export interface PackingOrder {
  id: string;
  status: OrderStatus;
  hasBill: boolean;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  zone: string;
  lines: PackingLine[];
  packages: { id: string; packagingType: PackagingType }[];
}

type View = "queue" | "detail" | "bill";

const SWIPE_THRESHOLD = 90;

function SwipeableLineRow({
  onSwipePacked,
  onSwipeUnavailable,
  children,
}: {
  onSwipePacked: () => void;
  onSwipeUnavailable: () => void;
  children: React.ReactNode;
}) {
  const x = useMotionValue(0);
  const packedOpacity = useTransform(x, [20, SWIPE_THRESHOLD], [0, 1]);
  const unavailableOpacity = useTransform(x, [-SWIPE_THRESHOLD, -20], [1, 0]);

  function handleDragEnd(_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    if (info.offset.x > SWIPE_THRESHOLD) onSwipePacked();
    else if (info.offset.x < -SWIPE_THRESHOLD) onSwipeUnavailable();
  }

  return (
    <div className="relative">
      <motion.div
        style={{ opacity: packedOpacity }}
        className="pointer-events-none absolute inset-0 flex items-center rounded-2xl bg-success-bg pl-4 text-success-text"
        aria-hidden="true"
      >
        <PackageCheck className="size-5" />
      </motion.div>
      <motion.div
        style={{ opacity: unavailableOpacity }}
        className="pointer-events-none absolute inset-0 flex items-center justify-end rounded-2xl bg-danger-bg pr-4 text-danger-text"
        aria-hidden="true"
      >
        <Ban className="size-5" />
      </motion.div>
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.5}
        onDragEnd={handleDragEnd}
        style={{ x }}
        className="relative rounded-2xl bg-white"
      >
        {children}
      </motion.div>
    </div>
  );
}

function QueueOrderCard({ order, onSelect }: { order: PackingOrder; onSelect: () => void }) {
  const displayStatus = deriveDisplayStatus(order.status, order.hasBill);
  const preview = `${order.lines.length} item${order.lines.length === 1 ? "" : "s"} · ${order.lines
    .map((l) => l.productName)
    .join(", ")}`;
  const packagingSummary = summarizePackaging(order.packages);
  return (
    <Card
      elevated
      onClick={onSelect}
      className={cn("cursor-pointer !space-y-1.5", order.status === "cancelled" && "opacity-70")}
    >
      <div className="flex items-center justify-between gap-2">
        <div
          className={cn(
            "font-display text-[15px] font-bold text-foreground",
            order.status === "cancelled" && "line-through",
          )}
        >
          {order.customerName}
        </div>
        <Badge style={displayStatusChipStyle(displayStatus)} size="sm">
          {DISPLAY_STATUS_LABEL[displayStatus]}
        </Badge>
      </div>
      <div className="font-sans text-[12.5px] font-medium text-muted">{preview}</div>
      {packagingSummary && (
        <div className="font-sans text-[11.5px] font-semibold text-tertiary">{packagingSummary}</div>
      )}
    </Card>
  );
}

function DetailHeader({ title, onBack, backLabel }: { title: string; onBack: () => void; backLabel: string }) {
  return (
    <div className="flex items-center justify-between">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 font-sans text-[13.5px] font-bold text-muted">
        <ChevronLeft className="size-4" /> {backLabel}
      </button>
      <span className="font-sans text-[13.5px] font-bold text-foreground">{title}</span>
      <span className="w-14" />
    </div>
  );
}

function EditableDetail({
  order,
  products,
  onBack,
  onFinalized,
}: {
  order: PackingOrder;
  products: { id: string; name: string; unitLabel?: string | null }[];
  onBack: () => void;
  onFinalized: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  type LineState = {
    resolution: "pending" | "packed" | "unavailable";
    actualQty: string;
    packageRef: string;
    addSubstitute: boolean;
    substituteProductId: string;
    substituteQty: string;
    substitutePackageRef: string;
  };
  const [lineStates, setLineStates] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(
      order.lines.map((line) => [
        line.id,
        {
          resolution: "pending",
          actualQty: "",
          packageRef: line.packageId ?? "",
          addSubstitute: false,
          substituteProductId: "",
          substituteQty: "",
          substitutePackageRef: "",
        },
      ]),
    ),
  );
  // Boxes/packets created during this editing session ("New: Big Box" picked
  // on some line) -- not saved until finalize. Keyed by a client tempId so
  // later lines can pick "the box I just made" before it has a real uuid.
  const [newPackages, setNewPackages] = useState<{ tempId: string; packagingType: PackagingType }[]>([]);

  function updateLine(lineId: string, patch: Partial<LineState>) {
    setLineStates((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  }

  // Every box/packet available to assign a line to: already-saved ones from
  // this order plus ones created earlier in this same session, annotated
  // with which products are currently assigned to each (for the dropdown
  // label, e.g. "Big Box (Banana, Papaya)").
  const packageOptions = [
    ...order.packages.map((p) => ({ ref: p.id, packagingType: p.packagingType })),
    ...newPackages.map((p) => ({ ref: p.tempId, packagingType: p.packagingType })),
  ].map((p) => {
    const contents = order.lines
      .filter((line) => lineStates[line.id]?.packageRef === p.ref)
      .map((line) => line.productName);
    return { ...p, contents };
  });

  function packagingSelectOptions() {
    return (
      <>
        <option value="">No packaging</option>
        {packageOptions.length > 0 && (
          <optgroup label="Add to existing">
            {packageOptions.map((p) => (
              <option key={p.ref} value={p.ref}>
                {PACKAGING_LABEL[p.packagingType]}
                {p.contents.length > 0 ? ` (${p.contents.join(", ")})` : ""}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="New">
          {PACKAGING_TYPES.map((t) => (
            <option key={t.value} value={`new:${t.value}`}>
              New: {t.label}
            </option>
          ))}
        </optgroup>
      </>
    );
  }

  // Turns a <select> value into the packageRef to store on the line: passes
  // through an existing ref unchanged, or mints a new local package (and
  // registers it in newPackages) for a "new:<type>" selection.
  function resolvePackagingSelection(value: string): string {
    if (!value.startsWith("new:")) return value;
    const packagingType = value.slice(4) as PackagingType;
    const tempId = `new-${crypto.randomUUID()}`;
    setNewPackages((prev) => [...prev, { tempId, packagingType }]);
    return tempId;
  }

  const pendingLines = order.lines.filter((l) => lineStates[l.id]?.resolution === "pending");
  const invalidPackedLines = order.lines.filter((l) => {
    const s = lineStates[l.id];
    return s.resolution === "packed" && !(Number(s.actualQty) > 0);
  });
  const invalidSubLines = order.lines.filter((l) => {
    const s = lineStates[l.id];
    return s.resolution === "unavailable" && s.addSubstitute && !(s.substituteProductId !== "" && Number(s.substituteQty) > 0);
  });
  const canFinalize = pendingLines.length === 0 && invalidPackedLines.length === 0 && invalidSubLines.length === 0;

  function handleFinalize() {
    setError(null);
    startTransition(async () => {
      const resolutions = order.lines.map((line) => {
        const s = lineStates[line.id];
        return {
          lineId: line.id,
          resolution: s.resolution as "packed" | "unavailable",
          actualQty: s.resolution === "packed" ? Number(s.actualQty) : null,
          packageRef: s.resolution === "packed" ? s.packageRef : null,
        };
      });
      const substitutions = order.lines
        .filter((line) => lineStates[line.id].resolution === "unavailable" && lineStates[line.id].addSubstitute)
        .map((line) => ({
          substitutedForLineId: line.id,
          productId: lineStates[line.id].substituteProductId,
          actualQty: Number(lineStates[line.id].substituteQty),
          packageRef: lineStates[line.id].substitutePackageRef,
        }));
      const result = await finalizeOrder(order.id, resolutions, substitutions, newPackages);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onFinalized();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <DetailHeader title={order.customerName} onBack={onBack} backLabel="Queue" />
      <div className="flex flex-col gap-2.5">
        {order.lines.map((line) => {
          const state = lineStates[line.id];
          return (
            <div key={line.id} className="space-y-2">
              <SwipeableLineRow
                onSwipePacked={() => updateLine(line.id, { resolution: "packed" })}
                onSwipeUnavailable={() => updateLine(line.id, { resolution: "unavailable" })}
              >
                <div
                  className={cn(
                    "space-y-2 rounded-2xl p-3.5",
                    state.resolution === "unavailable" ? "bg-[#F7F7F5]" : "bg-white",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className={cn("font-sans text-[15px] font-bold", state.resolution === "unavailable" ? "text-tertiary line-through" : "text-foreground")}>
                      {line.productName}
                    </div>
                    <div className="font-sans text-[11.5px] font-semibold text-muted">
                      Target {line.orderedQty ?? "—"} {line.orderedUnit ?? line.unitLabel ?? ""}
                    </div>
                  </div>
                  {state.resolution === "packed" && (
                    <>
                      <Input
                        size="lg"
                        type="number"
                        inputMode={line.unitType === "weight" ? "decimal" : "numeric"}
                        step={line.unitType === "weight" ? "0.001" : "1"}
                        min="0"
                        placeholder={`Actual ${line.unitLabel ?? ""}`}
                        value={state.actualQty}
                        onChange={(e) => updateLine(line.id, { actualQty: e.target.value })}
                        className={cn("w-full", Number(state.actualQty) > 0 && "border-success")}
                      />
                      <Select
                        className="w-full"
                        value={state.packageRef}
                        onChange={(e) => updateLine(line.id, { packageRef: resolvePackagingSelection(e.target.value) })}
                      >
                        {packagingSelectOptions()}
                      </Select>
                    </>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => updateLine(line.id, { resolution: "packed" })}
                      className={cn(
                        "flex-1 rounded-xl px-3 py-2.5 font-sans text-[11.5px] font-bold",
                        state.resolution === "packed" ? "bg-success text-white" : "bg-neutral-bg text-neutral-text",
                      )}
                    >
                      Packed
                    </button>
                    <button
                      type="button"
                      onClick={() => updateLine(line.id, { resolution: "unavailable" })}
                      className={cn(
                        "flex-1 rounded-xl px-3 py-2.5 font-sans text-[11.5px] font-bold",
                        state.resolution === "unavailable" ? "bg-danger-text text-white" : "bg-neutral-bg text-neutral-text",
                      )}
                    >
                      Unavailable
                    </button>
                    <button
                      type="button"
                      onClick={() => updateLine(line.id, { addSubstitute: !state.addSubstitute, resolution: "unavailable" })}
                      className={cn(
                        "flex-1 rounded-xl px-3 py-2.5 font-sans text-[11.5px] font-bold",
                        state.addSubstitute ? "bg-brand text-white" : "bg-neutral-bg text-neutral-text",
                      )}
                    >
                      Substitute
                    </button>
                  </div>
                  {state.resolution === "unavailable" && state.addSubstitute && (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Select
                          className="flex-1"
                          value={state.substituteProductId}
                          onChange={(e) => updateLine(line.id, { substituteProductId: e.target.value })}
                        >
                          <option value="">Substitute with…</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </Select>
                        <Input
                          className="w-20"
                          type="number"
                          step="0.001"
                          min="0"
                          placeholder="Qty"
                          value={state.substituteQty}
                          onChange={(e) => updateLine(line.id, { substituteQty: e.target.value })}
                        />
                      </div>
                      <Select
                        className="w-full"
                        value={state.substitutePackageRef}
                        onChange={(e) =>
                          updateLine(line.id, { substitutePackageRef: resolvePackagingSelection(e.target.value) })
                        }
                      >
                        {packagingSelectOptions()}
                      </Select>
                    </div>
                  )}
                </div>
              </SwipeableLineRow>
            </div>
          );
        })}
      </div>

      {error && <FormError>{error}</FormError>}
      {!canFinalize && (
        <div className="font-sans text-xs font-semibold text-danger-text space-y-0.5">
          {pendingLines.length > 0 && <p>{pendingLines.length} line(s) still need Packed or Unavailable.</p>}
          {invalidPackedLines.length > 0 && <p>Enter a quantity greater than zero for every packed line.</p>}
          {invalidSubLines.length > 0 && <p>Finish the substitute (product + qty) for every substituted line.</p>}
        </div>
      )}
      <Button variant="dark" fullWidth disabled={!canFinalize} onClick={handleFinalize} pending={pending} pendingText="Packing…">
        Pack & Close Order
      </Button>
    </div>
  );
}

function PackedLineRow({ line, onOverridden }: { line: PackingLine; onOverridden: () => void }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [packedInput, setPackedInput] = useState("");
  const [billedInput, setBilledInput] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [reasonInput, setReasonInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const price = line.lockedPricePerUnit ?? 0;
  const packed = line.actualQty ?? 0;
  const billed = line.billedQty ?? packed; // billed defaults to packed until edited

  function startEditing() {
    setPackedInput(packed ? String(packed) : "");
    setBilledInput(String(billed));
    setPriceInput(line.lockedPricePerUnit != null ? String(line.lockedPricePerUnit) : "");
    setReasonInput("");
    setError(null);
    setEditing(true);
  }

  function handleSave() {
    setError(null);
    const newPacked = Number(packedInput);
    const newBilled = Number(billedInput);
    // Blank rate = unchanged; an explicit 0 = free (e.g. a free replacement).
    const newPrice = priceInput.trim() === "" ? price : Number(priceInput);
    const packedChanged = newPacked !== packed;
    const billedChanged = newBilled !== billed;
    const priceChanged = newPrice !== price;
    if (!packedChanged && !billedChanged && !priceChanged) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      // Packed first, then billed. A billed qty nobody set follows packed.
      if (packedChanged) {
        const r = await overrideLineQuantity(line.id, newPacked, reasonInput, "actual");
        if (!r.ok) return setError(r.error);
      }
      if (billedChanged) {
        const r = await overrideLineQuantity(line.id, newBilled, reasonInput, "billed");
        if (!r.ok) return setError(r.error);
      }
      if (priceChanged) {
        const r = await overrideLinePrice(line.id, newPrice, reasonInput);
        if (!r.ok) return setError(r.error);
      }
      setEditing(false);
      onOverridden();
    });
  }

  if (editing) {
    return (
      <Card elevated className="!space-y-2">
        <div className="font-sans text-sm font-bold text-foreground">{line.productName}</div>
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 font-sans text-[11px] font-bold uppercase tracking-wide text-muted">
            Packed {line.unitLabel ?? ""}
            <Input
              size="lg"
              type="number"
              inputMode={line.unitType === "weight" ? "decimal" : "numeric"}
              step={line.unitType === "weight" ? "0.001" : "1"}
              min="0"
              value={packedInput}
              onChange={(e) => setPackedInput(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 font-sans text-[11px] font-bold uppercase tracking-wide text-muted">
            Billed {line.unitLabel ?? ""}
            <Input
              size="lg"
              type="number"
              inputMode={line.unitType === "weight" ? "decimal" : "numeric"}
              step={line.unitType === "weight" ? "0.001" : "1"}
              min="0"
              value={billedInput}
              onChange={(e) => setBilledInput(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 font-sans text-[11px] font-bold uppercase tracking-wide text-muted">
            ₹ / unit
            <Input
              size="lg"
              type="number"
              step="0.01"
              min="0"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
            />
          </label>
        </div>
        <Input
          size="lg"
          placeholder="Reason (required)"
          value={reasonInput}
          onChange={(e) => setReasonInput(e.target.value)}
          className="w-full"
        />
        {error && <FormError>{error}</FormError>}
        <div className="flex gap-2">
          <Button variant="secondary" fullWidth onClick={() => setEditing(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="dark" fullWidth onClick={handleSave} pending={pending} pendingText="Saving…">
            Save changes
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card elevated className="flex items-center justify-between !space-y-0">
      <div>
        <div className="font-sans text-sm font-bold text-foreground">{line.productName}</div>
        <div className="flex items-center gap-1.5 font-sans text-[11.5px] font-semibold text-muted">
          {billed} {line.unitLabel ?? ""} @ ₹{price.toFixed(2)}
          {billed !== packed && <span className="text-tertiary">(packed {packed})</span>}
          <button
            type="button"
            onClick={startEditing}
            aria-label={`Edit quantity or price for ${line.productName}`}
            className="text-tertiary"
          >
            <Pencil className="size-3" />
          </button>
        </div>
      </div>
      <div className="font-display text-sm font-bold text-foreground">₹{Math.round(billed * price).toFixed(2)}</div>
    </Card>
  );
}

// Billing packer's line at the billing step: weight/count can be corrected
// and the item removed -- no prices anywhere (src/lib/auth/billing-access.ts).
function PackerBillLineRow({ orderId, line, onChanged }: { orderId: string; line: PackingLine; onChanged: () => void }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [qtyInput, setQtyInput] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const packed = line.actualQty ?? 0;
  const qty = line.billedQty ?? packed; // billed qty; defaults to packed until edited

  function handleSave() {
    const newQty = Number(qtyInput);
    if (!Number.isFinite(newQty) || newQty < 0) {
      setError("Billed quantity can't be negative.");
      return;
    }
    if (newQty === qty) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await overrideLineQuantity(line.id, newQty, "Billed qty set at billing", "billed");
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      onChanged();
    });
  }

  function handleRemove() {
    if (!confirmRemove) {
      setConfirmRemove(true);
      setTimeout(() => setConfirmRemove(false), 3000);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await removePackedLine(orderId, line.id);
      if (!result.ok) {
        setError(result.error);
        setConfirmRemove(false);
        return;
      }
      onChanged();
    });
  }

  return (
    <Card elevated className="!space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-sans text-sm font-bold text-foreground">{line.productName}</div>
          {!editing && (
            <div className="font-sans text-[12.5px] font-semibold text-muted">
              Packed {line.actualQty ?? "—"} {line.unitLabel ?? ""} · <span className="text-foreground">Bill {qty} {line.unitLabel ?? ""}</span>
            </div>
          )}
        </div>
        {!editing && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setQtyInput(qty ? String(qty) : "");
                setError(null);
                setEditing(true);
              }}
              aria-label={`Edit billed quantity for ${line.productName}`}
              className="rounded-full p-2 text-muted disabled:opacity-40"
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={handleRemove}
              aria-label={`Remove ${line.productName}`}
              className={confirmRemove ? "rounded-full bg-danger-bg px-2 py-1 font-sans text-[11px] font-bold text-danger-text" : "rounded-full p-2 text-muted disabled:opacity-40"}
            >
              {confirmRemove ? "Remove?" : <Trash2 className="size-4" />}
            </button>
          </div>
        )}
      </div>
      {editing && (
        <div className="flex items-center gap-2">
          <Input
            size="lg"
            type="number"
            inputMode={line.unitType === "weight" ? "decimal" : "numeric"}
            step={line.unitType === "weight" ? "0.001" : "1"}
            min="0"
            autoFocus
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            className="w-28"
          />
          <span className="font-sans text-[12.5px] font-semibold text-muted">
            {line.unitLabel ?? ""} to bill (packed {packed})
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="dark" size="sm" onClick={handleSave} pending={pending} pendingText="Saving…">
              Save
            </Button>
          </div>
        </div>
      )}
      {error && <FormError>{error}</FormError>}
    </Card>
  );
}

function PackerAddItem({
  orderId,
  products,
  onChanged,
}: {
  orderId: string;
  products: { id: string; name: string; unitLabel?: string | null }[];
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const unit = products.find((p) => p.id === productId)?.unitLabel ?? "";

  function handleAdd() {
    const n = Number(qty);
    if (!productId) {
      setError("Pick an item.");
      return;
    }
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter a quantity greater than zero.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addPackedLine(orderId, productId, n);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setProductId("");
      setQty("");
      onChanged();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-neutral-300 py-2.5 font-sans text-[12.5px] font-bold text-muted dark:border-neutral-700"
      >
        <Plus className="size-4" aria-hidden="true" />
        Add item
      </button>
    );
  }
  return (
    <Card elevated className="!space-y-2">
      <select
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
        className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-sans text-sm dark:border-neutral-700 dark:bg-neutral-900"
      >
        <option value="">Pick an item…</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-2">
        <Input
          size="lg"
          type="number"
          inputMode="decimal"
          min="0"
          placeholder="Qty"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-28"
        />
        <span className="font-sans text-[12.5px] font-semibold text-muted">{unit}</span>
      </div>
      {error && <FormError>{error}</FormError>}
      <div className="flex gap-2">
        <Button variant="secondary" fullWidth onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
        <Button variant="dark" fullWidth onClick={handleAdd} pending={pending} pendingText="Adding…">
          Add
        </Button>
      </div>
    </Card>
  );
}

function PackedDetail({
  order,
  isAdmin,
  canGenerateBills,
  products,
  onBack,
  onBillGenerated,
}: {
  order: PackingOrder;
  isAdmin: boolean;
  // A packer with billing access (src/lib/auth/billing-access.ts): may
  // generate the bill, but sees no prices and never gets the send button.
  canGenerateBills: boolean;
  products: { id: string; name: string; unitLabel?: string | null }[];
  onBack: () => void;
  onBillGenerated: (bill: { messageText: string; customerPhone: string | null; paymentLinkError?: string }) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [needsSalutation, setNeedsSalutation] = useState(false);
  const packedLines = order.lines.filter((l) => l.lineStatus === "packed");
  const packagingSummary = summarizePackaging(order.packages);

  async function attemptGenerateBill() {
    setError(null);
    const result = await generateBill(order.id);
    if (!result.ok) {
      if (result.reason === "unpriced") {
        setError(
          isAdmin
            ? `${result.unpricedLineCount} item(s) still need a price.`
            : `${result.unpricedLineCount} item(s) have no price yet — ask the admin to add it, then generate the bill.`,
        );
      } else if (result.reason === "salutation_needed") {
        setNeedsSalutation(true);
      } else {
        setError(result.error);
      }
      return;
    }
    setNeedsSalutation(false);
    onBillGenerated({ messageText: result.messageText, customerPhone: result.customerPhone, paymentLinkError: result.paymentLinkError });
  }

  function handleGenerateBill() {
    startTransition(attemptGenerateBill);
  }

  function handlePickSalutation(salutation: "Sir" | "Ma'am") {
    startTransition(async () => {
      const result = await updateCustomerSalutation(order.customerId, salutation);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await attemptGenerateBill();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <DetailHeader title={order.customerName} onBack={onBack} backLabel="Queue" />
      {isAdmin ? (
        <>
          <div className="font-sans text-[11px] font-bold uppercase tracking-wide text-success">
            ✓ Packed — ready to bill
          </div>
          {packagingSummary && (
            <div className="font-sans text-[12.5px] font-semibold text-muted">{packagingSummary}</div>
          )}
          <div className="flex flex-col gap-2">
            {packedLines.map((line) => (
              <PackedLineRow key={line.id} line={line} onOverridden={() => router.refresh()} />
            ))}
          </div>
          {error && <FormError>{error}</FormError>}
          {needsSalutation ? (
            <div className="space-y-2 rounded-2xl bg-warning-bg p-3.5">
              <div className="font-sans text-[12.5px] font-semibold text-warning-text">
                Couldn&apos;t tell from the name — pick one:
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" fullWidth disabled={pending} onClick={() => handlePickSalutation("Sir")}>
                  Sir
                </Button>
                <Button variant="secondary" fullWidth disabled={pending} onClick={() => handlePickSalutation("Ma'am")}>
                  Ma&apos;am
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="primary" fullWidth onClick={handleGenerateBill} pending={pending} pendingText="Generating…">
              Generate Bill →
            </Button>
          )}
        </>
      ) : (
        <>
          <div className="font-sans text-[11px] font-bold uppercase tracking-wide text-muted">
            {order.hasBill
              ? "Billed — admin will send the bill"
              : canGenerateBills
                ? "✓ Packed — ready to bill"
                : "Packed — waiting on admin to bill"}
          </div>
          {packagingSummary && (
            <div className="font-sans text-[12.5px] font-semibold text-muted">{packagingSummary}</div>
          )}
          {canGenerateBills && !order.hasBill ? (
            <div className="flex flex-col gap-2">
              {packedLines.map((line) => (
                <PackerBillLineRow key={line.id} orderId={order.id} line={line} onChanged={() => router.refresh()} />
              ))}
              <PackerAddItem orderId={order.id} products={products} onChanged={() => router.refresh()} />
            </div>
          ) : (
          <div className="flex flex-col gap-2">
            {packedLines.map((line) => (
              <Card key={line.id} elevated className="flex items-center justify-between !space-y-0">
                <div className="font-sans text-sm font-bold text-foreground">{line.productName}</div>
                <div className="font-sans text-[12.5px] font-semibold text-muted">
                  {line.actualQty ?? "—"} {line.unitLabel ?? ""}
                </div>
              </Card>
            ))}
          </div>
          )}
          {canGenerateBills && !order.hasBill && (
            <>
              {error && <FormError>{error}</FormError>}
              {needsSalutation ? (
                <div className="space-y-2 rounded-2xl bg-warning-bg p-3.5">
                  <div className="font-sans text-[12.5px] font-semibold text-warning-text">
                    Couldn&apos;t tell from the name — pick one:
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" fullWidth disabled={pending} onClick={() => handlePickSalutation("Sir")}>
                      Sir
                    </Button>
                    <Button variant="secondary" fullWidth disabled={pending} onClick={() => handlePickSalutation("Ma'am")}>
                      Ma&apos;am
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="primary" fullWidth onClick={handleGenerateBill} pending={pending} pendingText="Generating…">
                  Generate Bill →
                </Button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function CancelledDetail({ order, onBack }: { order: PackingOrder; onBack: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <DetailHeader title={order.customerName} onBack={onBack} backLabel="Queue" />
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
        <div className="flex size-[52px] items-center justify-center rounded-2xl bg-danger-bg text-danger-text">
          <XCircle className="size-6" />
        </div>
        <div className="font-display text-[17px] font-bold text-foreground">Dropped / Cancelled</div>
        <div className="max-w-[260px] font-sans text-[13px] leading-[1.6] text-muted">
          All items were marked unavailable — this order was not packed or billed.
        </div>
      </div>
      <Button variant="secondary" fullWidth onClick={onBack}>
        Back to Queue
      </Button>
    </div>
  );
}

function BillView({
  bill,
  onDone,
}: {
  bill: { messageText: string; customerPhone: string | null; paymentLinkError?: string };
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-sans text-[13.5px] font-bold text-muted">Bill ready</span>
        <span className="w-14" />
      </div>
      <div className="font-sans text-[11px] font-bold uppercase tracking-wide text-muted">
        Sent as &quot;Sunita&quot; · WhatsApp preview
      </div>
      {bill.paymentLinkError && (
        <p className="rounded-xl bg-warning-bg px-3 py-2 font-sans text-xs text-warning-text">
          Razorpay link couldn&apos;t be made ({bill.paymentLinkError}), so this bill has no link. Tap Generate Bill on this order again to retry, or send it as is.
        </p>
      )}
      <div className="rounded-2xl rounded-bl-[4px] bg-[#DCF3D5] p-4">
        <div className="whitespace-pre-wrap font-sans text-[13.5px] leading-[1.7] text-foreground">{bill.messageText}</div>
      </div>
      {bill.customerPhone ? (
        <a
          href={`https://wa.me/${toWhatsAppDigits(bill.customerPhone)}?text=${encodeURIComponent(bill.messageText)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 rounded-2xl bg-success px-4 py-[18px] font-sans text-base font-extrabold text-white"
        >
          <MessageCircle className="size-5" /> Open in WhatsApp →
        </a>
      ) : (
        <FormError>No phone number on file for this customer — send the bill manually.</FormError>
      )}
      <Button variant="secondary" fullWidth onClick={onDone}>
        Done — move to dispatch
      </Button>
    </div>
  );
}

export function PackingScreen({
  date,
  orders,
  products,
  isAdmin,
  canGenerateBills = false,
}: {
  date: string;
  orders: PackingOrder[];
  products: { id: string; name: string; unitLabel?: string | null }[];
  isAdmin: boolean;
  canGenerateBills?: boolean;
}) {
  const router = useRouter();
  const isToday = date === utcToIstDatetimeLocal(new Date()).slice(0, 10);
  const dateLabel = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const { showToast } = useToast();
  const [view, setView] = useState<View>("queue");
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [bill, setBill] = useState<{ messageText: string; customerPhone: string | null; paymentLinkError?: string } | null>(null);

  const toPack = orders.filter((o) => o.status === "recorded");
  const readyToBill = orders.filter((o) => o.status === "packed");
  const dropped = orders.filter((o) => o.status === "cancelled");
  const activeOrder = orders.find((o) => o.id === activeOrderId) ?? null;

  function openOrder(id: string) {
    setActiveOrderId(id);
    setView("detail");
  }
  function backToQueue() {
    setView("queue");
    setActiveOrderId(null);
  }
  function handleFinalized() {
    showToast("Order packed ✓");
    backToQueue();
    router.refresh();
  }
  function handleBillGenerated(b: { messageText: string; customerPhone: string | null; paymentLinkError?: string }) {
    if (!isAdmin) {
      // Billing packer: the bill exists, the admin sends it.
      showToast("Bill generated ✓ — admin will send it");
      backToQueue();
      router.refresh();
      return;
    }
    setBill(b);
    setView("bill");
  }
  function handleDoneBill() {
    setBill(null);
    backToQueue();
    router.refresh();
  }

  return (
    <div className="pb-6">
      <AnimatePresence mode="wait">
        {view === "queue" && (
          <motion.div key="queue" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            <div className="mb-4">
              <h1 className="font-display text-[23px] font-bold text-foreground">Packing Queue</h1>
              <p className="mt-[3px] font-sans text-xs font-medium text-muted">
                {toPack.length} order{toPack.length === 1 ? "" : "s"} waiting{!isToday && ` · ${dateLabel}`}
              </p>
            </div>

            {orders.length === 0 && <p className="font-sans text-sm text-muted">Nothing to pack right now.</p>}

            <div className="flex flex-col gap-4">
              {toPack.length > 0 && (
                <div className="flex flex-col gap-2">
                  {toPack.map((order) => (
                    <QueueOrderCard key={order.id} order={order} onSelect={() => openOrder(order.id)} />
                  ))}
                </div>
              )}

              {readyToBill.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="px-0.5 font-sans text-[11px] font-bold uppercase tracking-wide text-muted">
                    Packed · Ready to bill
                  </div>
                  {readyToBill.map((order) => (
                    <QueueOrderCard key={order.id} order={order} onSelect={() => openOrder(order.id)} />
                  ))}
                </div>
              )}

              {dropped.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="px-0.5 font-sans text-[11px] font-bold uppercase tracking-wide text-muted">
                    Dropped / Cancelled
                  </div>
                  {dropped.map((order) => (
                    <QueueOrderCard key={order.id} order={order} onSelect={() => openOrder(order.id)} />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {view === "detail" && activeOrder && (
          <motion.div key="detail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {activeOrder.status === "recorded" && (
              <EditableDetail order={activeOrder} products={products} onBack={backToQueue} onFinalized={handleFinalized} />
            )}
            {activeOrder.status === "packed" && (
              <PackedDetail
                order={activeOrder}
                isAdmin={isAdmin}
                canGenerateBills={canGenerateBills}
                products={products}
                onBack={backToQueue}
                onBillGenerated={handleBillGenerated}
              />
            )}
            {activeOrder.status === "cancelled" && <CancelledDetail order={activeOrder} onBack={backToQueue} />}
          </motion.div>
        )}

        {view === "bill" && bill && (
          <motion.div key="bill" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            <BillView bill={bill} onDone={handleDoneBill} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
