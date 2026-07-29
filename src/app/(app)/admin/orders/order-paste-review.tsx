"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Check, Minus, Plus } from "lucide-react";
import { parseOrderDraft, saveOrder, type DraftLine, type SaveOrderLine } from "@/app/actions/orders";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { deriveZoneFromAddress } from "@/lib/customers/zone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { FormError } from "@/components/ui/form-error";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

type Step = "paste" | "review";

interface CustomerOption {
  id: string;
  name: string;
  phone: string | null;
}

interface ProductOption {
  id: string;
  name: string;
}

type CustomerResolution =
  | { mode: "matched"; customerId: string }
  | { mode: "existing"; customerId: string }
  | { mode: "new"; displayName: string; phone: string; address: string };

interface Line extends DraftLine {
  originalProductId: string | null;
  rememberAlias: boolean;
  aliasText: string;
  uiResolution: "pending" | "note";
}

type SheetState = { kind: "edit" | "fix" | "map"; lineIndex: number } | null;

function lineIsOk(line: Line): boolean {
  return Boolean(line.productId) && Number.isFinite(line.qty) && (line.qty ?? 0) > 0;
}

function stepFor(unit: string | null): number {
  return unit?.toLowerCase().includes("kg") ? 0.5 : 1;
}

export function OrderPasteReview({
  customers,
  products,
}: {
  customers: CustomerOption[];
  products: ProductOption[];
}) {
  const router = useRouter();
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>("paste");
  const [rawText, setRawText] = useState("");
  const [placedAtLocal, setPlacedAtLocal] = useState(() => utcToIstDatetimeLocal(new Date()));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customerNameText, setCustomerNameText] = useState("");
  const [customerMatchConfidence, setCustomerMatchConfidence] = useState<"clean" | "flagged">("clean");
  const [resolution, setResolution] = useState<CustomerResolution>({ mode: "new", displayName: "", phone: "", address: "" });
  const [showCustomerResolver, setShowCustomerResolver] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);

  const [sheet, setSheet] = useState<SheetState>(null);
  const [sheetQty, setSheetQty] = useState(0);
  const [mapProductId, setMapProductId] = useState<string | null>(null);
  const [mapQty, setMapQty] = useState("");
  const [mapRememberAlias, setMapRememberAlias] = useState(true);

  const customerNameById = new Map(customers.map((c) => [c.id, c.name]));
  const productNameById = new Map(products.map((p) => [p.id, p.name]));

  async function handleParse(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await parseOrderDraft(rawText, placedAtLocal);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    const { customer, deliveryDate: derivedDate, notes: parsedNotes, lines: draftLines } = result.draft;
    setCustomerNameText(customer.nameText);
    setCustomerMatchConfidence(customer.confidence);
    setResolution(
      customer.matchedId
        ? { mode: "matched", customerId: customer.matchedId }
        : {
            mode: "new",
            displayName: customer.nameText,
            phone: customer.parsedPhone ?? "",
            address: customer.parsedAddress ?? "",
          },
    );
    setShowCustomerResolver(customer.confidence === "flagged" || !customer.matchedId);
    setDeliveryDate(derivedDate);
    setNotes(parsedNotes);
    setLines(
      draftLines.map((line) => ({
        ...line,
        originalProductId: line.productId,
        rememberAlias: line.productId === null,
        aliasText: line.rawText,
        uiResolution: "pending",
      })),
    );
    setStep("review");
  }

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  const activeLines = lines.filter((l) => l.uiResolution === "pending");
  const customerResolved =
    resolution.mode === "new"
      ? resolution.displayName.trim() !== "" && resolution.address.trim() !== ""
      : true;
  const canSave =
    customerResolved &&
    activeLines.length > 0 &&
    activeLines.every((line) => lineIsOk(line));
  const unresolvedLineCount = activeLines.filter((line) => !lineIsOk(line)).length;
  const unpricedLineCount = activeLines.filter((line) => line.productId && line.resolvedPrice === null).length;

  async function handleSave() {
    setError(null);
    setPending(true);

    const saveLines: SaveOrderLine[] = activeLines.map((line) => ({
      productId: line.productId as string,
      rawText: line.rawText,
      orderedQty: line.qty as number,
      orderedUnit: line.unit,
      confidence: line.confidence,
      parseNote: line.flagReason,
    }));

    const customerInput =
      resolution.mode === "new"
        ? {
            kind: "new" as const,
            displayName: resolution.displayName.trim(),
            phone: resolution.phone.trim() || null,
            address: resolution.address.trim(),
          }
        : { kind: "existing" as const, customerId: resolution.customerId };

    const result = await saveOrder({
      customer: customerInput,
      placedAtIst: placedAtLocal,
      deliveryDate,
      notes: notes.trim() || null,
      rawText,
      lines: saveLines,
      newAliases: activeLines
        .filter((line) => line.originalProductId === null && line.rememberAlias && line.productId)
        .map((line) => ({ productId: line.productId as string, alias: line.aliasText.trim() })),
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setStep("paste");
    setRawText("");
    setLines([]);
    setPlacedAtLocal(utcToIstDatetimeLocal(new Date()));
    showToast("Sent to Packing ✓");
    router.refresh();
  }

  function openEditSheet(index: number) {
    setSheet({ kind: "edit", lineIndex: index });
    setSheetQty(lines[index].qty ?? 0);
  }
  function openFixSheet(index: number) {
    setSheet({ kind: "fix", lineIndex: index });
  }
  function closeSheet() {
    setSheet(null);
  }
  function saveEditSheet() {
    if (!sheet) return;
    updateLine(sheet.lineIndex, { qty: sheetQty });
    closeSheet();
  }
  function resolveDiscard() {
    if (!sheet) return;
    setLines((prev) => prev.filter((_, i) => i !== sheet.lineIndex));
    closeSheet();
  }
  function resolveAsNote() {
    if (!sheet) return;
    const line = lines[sheet.lineIndex];
    setNotes((prev) => (prev ? `${prev}\n${line.rawText}` : line.rawText));
    updateLine(sheet.lineIndex, { uiResolution: "note" });
    closeSheet();
  }
  function openMapSheet() {
    if (!sheet) return;
    const line = lines[sheet.lineIndex];
    setMapProductId(line.productId);
    setMapQty(line.qty !== null ? String(line.qty) : "");
    setMapRememberAlias(true);
    setSheet({ kind: "map", lineIndex: sheet.lineIndex });
  }
  function saveMapSheet() {
    if (!sheet || !mapProductId) return;
    updateLine(sheet.lineIndex, {
      productId: mapProductId,
      qty: mapQty === "" ? null : Number(mapQty),
      rememberAlias: mapRememberAlias,
    });
    closeSheet();
  }

  const sheetLine = sheet ? lines[sheet.lineIndex] : null;

  return (
    <div className="pb-6">
      {step === "paste" && (
        <form onSubmit={handleParse} className="flex flex-col gap-3">
          <textarea
            required
            rows={9}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste WhatsApp message here…"
            className="w-full rounded-2xl border-[1.5px] border-[#ECEAE3] bg-[#F1F1EE] p-3.5 font-sans text-[14.5px] font-medium leading-[1.55] text-foreground focus:outline-none"
          />
          <label className="flex flex-col gap-1 max-w-xs">
            <span className="font-sans text-sm text-muted">Placed at (IST)</span>
            <Input type="datetime-local" value={placedAtLocal} onChange={(e) => setPlacedAtLocal(e.target.value)} />
          </label>
          {error && <FormError>{error}</FormError>}
          <Button type="submit" variant="dark" fullWidth pending={pending} pendingText="Parsing…">
            Parse Message
          </Button>
        </form>
      )}

      {step === "review" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep("paste")}
              className="inline-flex items-center gap-1 font-sans text-[13.5px] font-bold text-muted"
            >
              <ChevronLeft className="size-4" /> Back
            </button>
            <span className="font-sans text-[13.5px] font-bold text-foreground">Review Order</span>
            <span className="w-11" />
          </div>

          <div className="rounded-2xl bg-[#F1F1EE] p-3">
            <div className="mb-1 font-sans text-[10px] font-bold uppercase tracking-wide text-muted">
              Pasted message
            </div>
            <div className="whitespace-pre-wrap font-sans text-[12.5px] leading-[1.5] text-[#4b4d54]">{rawText}</div>
          </div>

          <Card elevated className="!space-y-0 !p-1.5">
            <div className="flex items-center justify-between gap-2.5 px-2.5 py-3">
              <div className="flex items-center gap-2.5">
                <Avatar name={resolution.mode === "new" ? resolution.displayName || customerNameText : customerNameById.get(resolution.customerId) ?? customerNameText} />
                <div>
                  <div className="font-display text-[15.5px] font-bold text-foreground">
                    {resolution.mode === "new"
                      ? resolution.displayName || customerNameText
                      : customerNameById.get(resolution.customerId) ?? customerNameText}
                  </div>
                  <div className="font-sans text-[11px] font-semibold text-success">
                    {resolution.mode === "matched"
                      ? "Matched customer"
                      : resolution.mode === "existing"
                        ? "Existing customer"
                        : "New customer"}
                  </div>
                </div>
              </div>
              {customerResolved ? (
                <span className="rounded-full bg-success-bg px-2.5 py-1 font-sans text-[11px] font-bold text-success-text">✓</span>
              ) : (
                <span className="rounded-full bg-warning-bg px-2.5 py-1 font-sans text-[11px] font-bold text-warning-text">
                  Incomplete
                </span>
              )}
            </div>

            {!showCustomerResolver ? (
              <button
                type="button"
                onClick={() => setShowCustomerResolver(true)}
                className="w-full border-t border-[#ECEAE3] px-2.5 py-2 text-left font-sans text-xs font-bold text-brand"
              >
                Not the right customer? Change
              </button>
            ) : (
              <div className="space-y-3 border-t border-[#ECEAE3] px-2.5 py-3">
                {customerMatchConfidence === "flagged" && (
                  <p className="font-sans text-xs font-bold text-danger-text">
                    Flagged — please confirm this customer
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex items-center gap-1.5 font-sans text-[13px] font-semibold">
                    <input
                      type="radio"
                      checked={resolution.mode === "matched" || resolution.mode === "existing"}
                      onChange={() => setResolution({ mode: "existing", customerId: customers[0]?.id ?? "" })}
                    />
                    Existing customer
                  </label>
                  {(resolution.mode === "matched" || resolution.mode === "existing") && (
                    <Select
                      value={resolution.customerId}
                      onChange={(e) => setResolution({ mode: "existing", customerId: e.target.value })}
                    >
                      {resolution.mode === "matched" && (
                        <option value={resolution.customerId}>
                          {customerNameById.get(resolution.customerId) ?? "Matched customer"}
                        </option>
                      )}
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.phone ? ` (${c.phone})` : ""}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
                <label className="flex items-center gap-1.5 font-sans text-[13px] font-semibold">
                  <input
                    type="radio"
                    checked={resolution.mode === "new"}
                    onChange={() => setResolution({ mode: "new", displayName: customerNameText, phone: "", address: "" })}
                  />
                  New customer
                </label>
                {resolution.mode === "new" && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Input
                      type="text"
                      placeholder="Name"
                      value={resolution.displayName}
                      onChange={(e) => setResolution({ ...resolution, displayName: e.target.value })}
                    />
                    <Input
                      type="text"
                      placeholder="Phone"
                      value={resolution.phone}
                      onChange={(e) => setResolution({ ...resolution, phone: e.target.value })}
                    />
                    <div className="space-y-1">
                      <Input
                        type="text"
                        placeholder="Address"
                        value={resolution.address}
                        onChange={(e) => setResolution({ ...resolution, address: e.target.value })}
                        className="w-full"
                      />
                      <p className="font-sans text-xs text-muted">
                        Zone: {resolution.address ? deriveZoneFromAddress(resolution.address) : "—"}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-sans text-sm text-muted">Delivery date</span>
              <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </label>
            <label className="flex flex-1 min-w-48 flex-col gap-1">
              <span className="font-sans text-sm text-muted">Notes</span>
              <Input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full" />
            </label>
          </div>

          <Card elevated className="!space-y-0 !p-1">
            {lines.map((line, index) => {
              const isNote = line.uiResolution === "note";
              const ok = !isNote && lineIsOk(line);
              const productName = line.productId ? productNameById.get(line.productId) ?? line.rawText : line.rawText;
              return (
                <div
                  key={index}
                  onClick={isNote ? undefined : () => (ok ? openEditSheet(index) : openFixSheet(index))}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl p-2.5",
                    isNote ? "opacity-60" : "cursor-pointer",
                    !ok && !isNote && "bg-[#FFF4E8]",
                  )}
                >
                  {!ok || isNote ? (
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning-bg font-sans text-base font-extrabold text-warning-text">
                      ?
                    </div>
                  ) : (
                    <Avatar name={productName} shape="square" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-sans text-[14.5px] font-bold text-foreground">{productName}</div>
                    <div className="font-sans text-xs font-semibold text-muted">
                      {isNote
                        ? "Kept as delivery note"
                        : ok
                          ? `${line.qty} ${line.unit ?? ""}`
                          : "Needs a fix — tap to resolve"}
                    </div>
                  </div>
                  {isNote ? (
                    <Badge tone="neutral" size="sm">
                      Note
                    </Badge>
                  ) : ok ? (
                    <Check className="size-[18px] shrink-0 text-success" />
                  ) : (
                    <Badge style={{ background: "#F2952E", color: "#fff" }} size="sm">
                      FIX
                    </Badge>
                  )}
                </div>
              );
            })}
          </Card>

          {error && <FormError>{error}</FormError>}
          {!canSave && (
            <FormError>
              {unresolvedLineCount > 0
                ? `${unresolvedLineCount} line${unresolvedLineCount === 1 ? "" : "s"} still need to be resolved.`
                : "Resolve the customer before saving."}
            </FormError>
          )}
          {canSave && unpricedLineCount > 0 && (
            <FormError>
              {unpricedLineCount} line{unpricedLineCount === 1 ? "" : "s"} have no price — order can be saved but
              cannot be billed until priced.
            </FormError>
          )}

          <Button
            variant="primary"
            fullWidth
            disabled={!canSave}
            onClick={handleSave}
            pending={pending}
            pendingText="Saving…"
          >
            {canSave ? "Confirm & Send to Packing →" : "Resolve flagged item to continue"}
          </Button>
        </div>
      )}

      <BottomSheet open={sheet?.kind === "edit"} onClose={closeSheet}>
        {sheetLine && (
          <div>
            <div className="mb-0.5 font-display text-base font-bold text-foreground">
              {sheetLine.productId ? productNameById.get(sheetLine.productId) ?? sheetLine.rawText : sheetLine.rawText}
            </div>
            <div className="mb-[18px] font-sans text-[12.5px] font-medium text-muted">Adjust quantity</div>
            <div className="mb-[22px] flex items-center justify-center gap-[22px]">
              <button
                type="button"
                onClick={() => setSheetQty((q) => Math.max(0, +(q - stepFor(sheetLine.unit)).toFixed(2)))}
                className="flex size-[52px] items-center justify-center rounded-2xl bg-neutral-bg text-foreground"
              >
                <Minus className="size-5" />
              </button>
              <div className="min-w-[90px] text-center font-display text-[30px] font-extrabold text-foreground">
                {sheetQty} {sheetLine.unit}
              </div>
              <button
                type="button"
                onClick={() => setSheetQty((q) => +(q + stepFor(sheetLine.unit)).toFixed(2))}
                className="flex size-[52px] items-center justify-center rounded-2xl bg-foreground text-white"
              >
                <Plus className="size-5" />
              </button>
            </div>
            <Button variant="primary" fullWidth onClick={saveEditSheet}>
              Save
            </Button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={sheet?.kind === "fix"} onClose={closeSheet}>
        {sheetLine && (
          <div>
            <div className="mb-0.5 font-display text-base font-bold text-foreground">&quot;{sheetLine.rawText}&quot;</div>
            <div className="mb-[18px] font-sans text-[12.5px] font-medium text-muted">
              This needs a fix before it can be sent to packing — what should we do?
            </div>
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={openMapSheet}
                className="rounded-2xl border-[1.5px] border-[#ECEAE3] bg-white px-4 py-3.5 text-left font-sans text-[13.5px] font-bold text-foreground"
              >
                Map to a product
              </button>
              <button
                type="button"
                onClick={resolveAsNote}
                className="rounded-2xl border-[1.5px] border-[#ECEAE3] bg-white px-4 py-3.5 text-left font-sans text-[13.5px] font-bold text-foreground"
              >
                Keep as delivery note
              </button>
              <button
                type="button"
                onClick={resolveDiscard}
                className="rounded-2xl border-[1.5px] border-[#ECEAE3] bg-white px-4 py-3.5 text-left font-sans text-[13.5px] font-bold text-danger-text"
              >
                Discard — not relevant
              </button>
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={sheet?.kind === "map"} onClose={closeSheet}>
        {sheetLine && (
          <div className="space-y-3">
            <div>
              <div className="mb-0.5 font-display text-base font-bold text-foreground">&quot;{sheetLine.rawText}&quot;</div>
              <div className="font-sans text-[12.5px] font-medium text-muted">Map this to a catalog product</div>
            </div>
            <Select value={mapProductId ?? ""} onChange={(e) => setMapProductId(e.target.value || null)} className="w-full">
              <option value="">Select product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              step="0.001"
              min="0"
              placeholder="Quantity"
              value={mapQty}
              onChange={(e) => setMapQty(e.target.value)}
              className="w-full"
            />
            {sheetLine.originalProductId === null && (
              <label className="flex items-center gap-1.5 font-sans text-xs font-semibold text-muted">
                <input
                  type="checkbox"
                  checked={mapRememberAlias}
                  onChange={(e) => setMapRememberAlias(e.target.checked)}
                />
                Remember &quot;{sheetLine.rawText}&quot; as this product next time
              </label>
            )}
            <Button variant="primary" fullWidth disabled={!mapProductId} onClick={saveMapSheet}>
              Save
            </Button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
