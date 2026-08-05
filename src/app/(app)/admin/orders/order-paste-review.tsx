"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Check, Minus, Plus } from "lucide-react";
import {
  parseOrderBatchDraft,
  saveOrder,
  type DraftLine,
  type SaveOrderLine,
  type SaveOrderInput,
} from "@/app/actions/orders";
import { createProduct } from "@/app/actions/products";
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

type Step = "paste" | "list" | "review";

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

interface Draft {
  key: string;
  rawText: string;
  customerNameText: string;
  customerMatchConfidence: "clean" | "flagged";
  resolution: CustomerResolution;
  showCustomerResolver: boolean;
  deliveryDate: string;
  notes: string;
  lines: Line[];
  saveError: string | null;
}

type SheetState = { kind: "edit" | "fix" | "map"; lineIndex: number } | null;

function lineIsOk(line: Line): boolean {
  return Boolean(line.productId) && Number.isFinite(line.qty) && (line.qty ?? 0) > 0;
}

function stepFor(unit: string | null): number {
  return unit?.toLowerCase().includes("kg") ? 0.5 : 1;
}

function draftIsReady(draft: Draft): boolean {
  const activeLines = draft.lines.filter((l) => l.uiResolution === "pending");
  const customerResolved =
    draft.resolution.mode === "new"
      ? draft.resolution.displayName.trim() !== "" && draft.resolution.address.trim() !== ""
      : true;
  return customerResolved && activeLines.length > 0 && activeLines.every(lineIsOk);
}

function buildSaveLines(draft: Draft): SaveOrderLine[] {
  return draft.lines
    .filter((l) => l.uiResolution === "pending")
    .map((line) => ({
      productId: line.productId as string,
      rawText: line.rawText,
      orderedQty: line.qty as number,
      orderedUnit: line.unit,
      confidence: line.confidence,
      parseNote: line.flagReason,
    }));
}

function buildCustomerInput(draft: Draft): SaveOrderInput["customer"] {
  return draft.resolution.mode === "new"
    ? {
        kind: "new",
        displayName: draft.resolution.displayName.trim(),
        phone: draft.resolution.phone.trim() || null,
        address: draft.resolution.address.trim(),
      }
    : { kind: "existing", customerId: draft.resolution.customerId };
}

function buildNewAliases(draft: Draft): { productId: string; alias: string }[] {
  return draft.lines
    .filter((line) => line.originalProductId === null && line.rememberAlias && line.productId)
    .map((line) => ({ productId: line.productId as string, alias: line.aliasText.trim() }));
}

let draftKeySeq = 0;
function nextDraftKey(): string {
  draftKeySeq += 1;
  return `draft-${Date.now()}-${draftKeySeq}`;
}

export function OrderPasteReview({
  customers,
  products: initialProducts,
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

  const [products, setProducts] = useState<ProductOption[]>(initialProducts);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [reviewOrigin, setReviewOrigin] = useState<"paste" | "list">("paste");
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  const [sheet, setSheet] = useState<SheetState>(null);
  const [sheetQty, setSheetQty] = useState(0);
  const [mapMode, setMapMode] = useState<"existing" | "new">("existing");
  const [mapProductId, setMapProductId] = useState<string | null>(null);
  const [mapQty, setMapQty] = useState("");
  const [mapRememberAlias, setMapRememberAlias] = useState(true);
  const [newProductName, setNewProductName] = useState("");
  const [newProductUnitType, setNewProductUnitType] = useState<"weight" | "count">("count");
  const [newProductUnitLabel, setNewProductUnitLabel] = useState("piece");
  const [mapSaving, setMapSaving] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const customerNameById = new Map(customers.map((c) => [c.id, c.name]));
  const productNameById = new Map(products.map((p) => [p.id, p.name]));

  const current = activeIndex !== null ? (drafts[activeIndex] ?? null) : null;

  function buildDraft(draft: {
    rawText: string;
    customer: { matchedId: string | null; nameText: string; parsedPhone: string | null; parsedAddress: string | null; confidence: "clean" | "flagged" };
    deliveryDate: string;
    notes: string;
    lines: DraftLine[];
  }): Draft {
    return {
      key: nextDraftKey(),
      rawText: draft.rawText,
      customerNameText: draft.customer.nameText,
      customerMatchConfidence: draft.customer.confidence,
      resolution: draft.customer.matchedId
        ? { mode: "matched", customerId: draft.customer.matchedId }
        : {
            mode: "new",
            displayName: draft.customer.nameText,
            phone: draft.customer.parsedPhone ?? "",
            address: draft.customer.parsedAddress ?? "",
          },
      showCustomerResolver: draft.customer.confidence === "flagged" || !draft.customer.matchedId,
      deliveryDate: draft.deliveryDate,
      notes: draft.notes,
      lines: draft.lines.map((line) => ({
        ...line,
        originalProductId: line.productId,
        rememberAlias: line.productId === null,
        aliasText: line.rawText,
        uiResolution: "pending",
      })),
      saveError: null,
    };
  }

  async function handleParse(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await parseOrderBatchDraft(rawText, placedAtLocal);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    const newDrafts = result.drafts.map(buildDraft);
    setDrafts(newDrafts);
    setBatchError(null);
    if (newDrafts.length === 1) {
      setActiveIndex(0);
      setReviewOrigin("paste");
      setStep("review");
    } else {
      setActiveIndex(null);
      setStep("list");
    }
  }

  function updateDraft(index: number, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function updateCurrentDraft(patch: Partial<Draft>) {
    if (activeIndex === null) return;
    updateDraft(activeIndex, patch);
  }

  function updateCurrentLine(lineIndex: number, patch: Partial<Line>) {
    if (activeIndex === null) return;
    setDrafts((prev) =>
      prev.map((d, i) =>
        i !== activeIndex ? d : { ...d, lines: d.lines.map((l, li) => (li === lineIndex ? { ...l, ...patch } : l)) },
      ),
    );
  }

  function removeCurrentLine(lineIndex: number) {
    if (activeIndex === null) return;
    setDrafts((prev) =>
      prev.map((d, i) => (i !== activeIndex ? d : { ...d, lines: d.lines.filter((_, li) => li !== lineIndex) })),
    );
  }

  const activeLines = current ? current.lines.filter((l) => l.uiResolution === "pending") : [];
  const customerResolved = current
    ? current.resolution.mode === "new"
      ? current.resolution.displayName.trim() !== "" && current.resolution.address.trim() !== ""
      : true
    : false;
  const canSave = customerResolved && activeLines.length > 0 && activeLines.every((line) => lineIsOk(line));
  const unresolvedLineCount = activeLines.filter((line) => !lineIsOk(line)).length;
  const unpricedLineCount = activeLines.filter((line) => line.productId && line.resolvedPrice === null).length;

  async function handleSaveCurrent() {
    if (activeIndex === null || !current) return;
    setError(null);
    setPending(true);

    const result = await saveOrder({
      customer: buildCustomerInput(current),
      placedAtIst: placedAtLocal,
      deliveryDate: current.deliveryDate,
      notes: current.notes.trim() || null,
      rawText: current.rawText,
      lines: buildSaveLines(current),
      newAliases: buildNewAliases(current),
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    const wasOnlyDraft = drafts.length === 1;
    setDrafts((prev) => prev.filter((_, i) => i !== activeIndex));
    setActiveIndex(null);
    showToast("Sent to Packing ✓");
    router.refresh();

    if (wasOnlyDraft) {
      setStep("paste");
      setRawText("");
      setPlacedAtLocal(utcToIstDatetimeLocal(new Date()));
    } else {
      setStep("list");
    }
  }

  async function handleSaveAllReady() {
    const candidates = drafts.filter(draftIsReady);
    if (candidates.length === 0) return;

    setBatchSaving(true);
    setBatchError(null);

    const succeededKeys: string[] = [];
    let firstError: string | null = null;

    for (const draft of candidates) {
      const result = await saveOrder({
        customer: buildCustomerInput(draft),
        placedAtIst: placedAtLocal,
        deliveryDate: draft.deliveryDate,
        notes: draft.notes.trim() || null,
        rawText: draft.rawText,
        lines: buildSaveLines(draft),
        newAliases: buildNewAliases(draft),
      });

      if (result.ok) {
        succeededKeys.push(draft.key);
      } else {
        firstError = firstError ?? result.error;
        const failedKey = draft.key;
        setDrafts((prev) => prev.map((d) => (d.key === failedKey ? { ...d, saveError: result.error } : d)));
      }
    }

    setBatchSaving(false);
    setDrafts((prev) => prev.filter((d) => !succeededKeys.includes(d.key)));

    if (succeededKeys.length > 0) {
      showToast(`Sent ${succeededKeys.length} order${succeededKeys.length === 1 ? "" : "s"} to Packing ✓`);
      router.refresh();
    }
    if (firstError) {
      const failedCount = candidates.length - succeededKeys.length;
      setBatchError(`${firstError} — the rest saved fine. ${failedCount} order${failedCount === 1 ? "" : "s"} still need fixing.`);
    } else if (drafts.length === candidates.length && succeededKeys.length === candidates.length) {
      setStep("paste");
      setRawText("");
      setPlacedAtLocal(utcToIstDatetimeLocal(new Date()));
    }
  }

  function openEditSheet(index: number) {
    if (!current) return;
    setSheet({ kind: "edit", lineIndex: index });
    setSheetQty(current.lines[index].qty ?? 0);
  }
  function openFixSheet(index: number) {
    setSheet({ kind: "fix", lineIndex: index });
  }
  function closeSheet() {
    setSheet(null);
    setMapError(null);
  }
  function saveEditSheet() {
    if (!sheet) return;
    updateCurrentLine(sheet.lineIndex, { qty: sheetQty });
    closeSheet();
  }
  function resolveDiscard() {
    if (!sheet) return;
    removeCurrentLine(sheet.lineIndex);
    closeSheet();
  }
  function resolveAsNote() {
    if (!sheet || !current) return;
    const line = current.lines[sheet.lineIndex];
    updateCurrentDraft({ notes: current.notes ? `${current.notes}\n${line.rawText}` : line.rawText });
    updateCurrentLine(sheet.lineIndex, { uiResolution: "note" });
    closeSheet();
  }
  function openMapSheet() {
    if (!sheet || !current) return;
    const line = current.lines[sheet.lineIndex];
    setMapMode("existing");
    setMapProductId(line.productId);
    setMapQty(line.qty !== null ? String(line.qty) : "");
    setMapRememberAlias(true);
    setNewProductName(line.rawText);
    setNewProductUnitType("count");
    setNewProductUnitLabel("piece");
    setMapError(null);
    setSheet({ kind: "map", lineIndex: sheet.lineIndex });
  }
  async function saveMapSheet() {
    if (!sheet) return;

    if (mapMode === "new") {
      const name = newProductName.trim();
      const unitLabel = newProductUnitLabel.trim();
      if (!name || !unitLabel) return;
      setMapSaving(true);
      setMapError(null);
      const result = await createProduct({ name, unitType: newProductUnitType, unitLabel });
      setMapSaving(false);
      if (!result.ok) {
        setMapError(result.error);
        return;
      }
      setProducts((prev) => [...prev, result.product].sort((a, b) => a.name.localeCompare(b.name)));
      updateCurrentLine(sheet.lineIndex, {
        productId: result.product.id,
        qty: mapQty === "" ? null : Number(mapQty),
        rememberAlias: mapRememberAlias,
      });
      closeSheet();
      return;
    }

    if (!mapProductId) return;
    updateCurrentLine(sheet.lineIndex, {
      productId: mapProductId,
      qty: mapQty === "" ? null : Number(mapQty),
      rememberAlias: mapRememberAlias,
    });
    closeSheet();
  }

  const sheetLine = current && sheet ? current.lines[sheet.lineIndex] : null;
  const readyCount = drafts.filter(draftIsReady).length;

  return (
    <div className="pb-6">
      {step === "paste" && (
        <form onSubmit={handleParse} className="flex flex-col gap-3">
          <textarea
            required
            rows={9}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste one or more WhatsApp messages here…"
            className="w-full rounded-2xl border-[1.5px] border-[#ECEAE3] bg-[#F1F1EE] p-3.5 font-sans text-[14.5px] font-medium leading-[1.55] text-foreground focus:outline-none"
          />
          <label className="flex flex-col gap-1 max-w-xs">
            <span className="font-sans text-sm text-muted">Placed at (IST)</span>
            <Input type="datetime-local" value={placedAtLocal} onChange={(e) => setPlacedAtLocal(e.target.value)} />
          </label>
          {error && <FormError>{error}</FormError>}
          <Button type="submit" variant="dark" fullWidth pending={pending} pendingText="Parsing…">
            Parse Message{"s"}
          </Button>
        </form>
      )}

      {step === "list" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep("paste")}
              className="inline-flex items-center gap-1 font-sans text-[13.5px] font-bold text-muted"
            >
              <ChevronLeft className="size-4" /> Back
            </button>
            <span className="font-sans text-[13.5px] font-bold text-foreground">
              {drafts.length} Order{drafts.length === 1 ? "" : "s"} Found
            </span>
            <span className="w-11" />
          </div>

          <div className="flex flex-col gap-2">
            {drafts.map((draft, index) => {
              const ready = draftIsReady(draft);
              const name =
                draft.resolution.mode === "new"
                  ? draft.resolution.displayName || draft.customerNameText
                  : (customerNameById.get(draft.resolution.customerId) ?? draft.customerNameText);
              const lineCount = draft.lines.filter((l) => l.uiResolution === "pending").length;
              return (
                <Card key={draft.key} elevated className="!space-y-0 !p-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveIndex(index);
                      setReviewOrigin("list");
                      setStep("review");
                    }}
                    className="flex w-full items-center gap-2.5 px-2.5 py-3 text-left"
                  >
                    <Avatar name={name} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-[15px] font-bold text-foreground">{name}</div>
                      <div className="font-sans text-xs font-semibold text-muted">
                        {lineCount} item{lineCount === 1 ? "" : "s"}
                        {draft.saveError ? ` — ${draft.saveError}` : ""}
                      </div>
                    </div>
                    {ready ? (
                      <Badge tone="success" size="sm">
                        Ready
                      </Badge>
                    ) : (
                      <Badge style={{ background: "#F2952E", color: "#fff" }} size="sm">
                        Needs fix
                      </Badge>
                    )}
                  </button>
                </Card>
              );
            })}
          </div>

          {batchError && <FormError>{batchError}</FormError>}

          <Button
            variant="primary"
            fullWidth
            disabled={readyCount === 0}
            onClick={handleSaveAllReady}
            pending={batchSaving}
            pendingText="Saving…"
          >
            {readyCount > 0 ? `Save ${readyCount} Ready Order${readyCount === 1 ? "" : "s"} →` : "No orders ready yet"}
          </Button>
        </div>
      )}

      {step === "review" && current && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep(reviewOrigin === "list" ? "list" : "paste")}
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
            <div className="whitespace-pre-wrap font-sans text-[12.5px] leading-[1.5] text-[#4b4d54]">
              {current.rawText}
            </div>
          </div>

          <Card elevated className="!space-y-0 !p-1.5">
            <div className="flex items-center justify-between gap-2.5 px-2.5 py-3">
              <div className="flex items-center gap-2.5">
                <Avatar
                  name={
                    current.resolution.mode === "new"
                      ? current.resolution.displayName || current.customerNameText
                      : (customerNameById.get(current.resolution.customerId) ?? current.customerNameText)
                  }
                />
                <div>
                  <div className="font-display text-[15.5px] font-bold text-foreground">
                    {current.resolution.mode === "new"
                      ? current.resolution.displayName || current.customerNameText
                      : (customerNameById.get(current.resolution.customerId) ?? current.customerNameText)}
                  </div>
                  <div className="font-sans text-[11px] font-semibold text-success">
                    {current.resolution.mode === "matched"
                      ? "Matched customer"
                      : current.resolution.mode === "existing"
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

            {!current.showCustomerResolver ? (
              <button
                type="button"
                onClick={() => updateCurrentDraft({ showCustomerResolver: true })}
                className="w-full border-t border-[#ECEAE3] px-2.5 py-2 text-left font-sans text-xs font-bold text-brand"
              >
                Not the right customer? Change
              </button>
            ) : (
              <div className="space-y-3 border-t border-[#ECEAE3] px-2.5 py-3">
                {current.customerMatchConfidence === "flagged" && (
                  <p className="font-sans text-xs font-bold text-danger-text">
                    Flagged — please confirm this customer
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex items-center gap-1.5 font-sans text-[13px] font-semibold">
                    <input
                      type="radio"
                      checked={current.resolution.mode === "matched" || current.resolution.mode === "existing"}
                      onChange={() => updateCurrentDraft({ resolution: { mode: "existing", customerId: customers[0]?.id ?? "" } })}
                    />
                    Existing customer
                  </label>
                  {(current.resolution.mode === "matched" || current.resolution.mode === "existing") && (
                    <Select
                      value={current.resolution.customerId}
                      onChange={(e) => updateCurrentDraft({ resolution: { mode: "existing", customerId: e.target.value } })}
                    >
                      {current.resolution.mode === "matched" && (
                        <option value={current.resolution.customerId}>
                          {customerNameById.get(current.resolution.customerId) ?? "Matched customer"}
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
                    checked={current.resolution.mode === "new"}
                    onChange={() =>
                      updateCurrentDraft({ resolution: { mode: "new", displayName: current.customerNameText, phone: "", address: "" } })
                    }
                  />
                  New customer
                </label>
                {current.resolution.mode === "new" && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Input
                      type="text"
                      placeholder="Name"
                      value={current.resolution.displayName}
                      onChange={(e) =>
                        updateCurrentDraft({ resolution: { ...current.resolution, displayName: e.target.value } as CustomerResolution })
                      }
                    />
                    <Input
                      type="text"
                      placeholder="Phone"
                      value={current.resolution.phone}
                      onChange={(e) =>
                        updateCurrentDraft({ resolution: { ...current.resolution, phone: e.target.value } as CustomerResolution })
                      }
                    />
                    <div className="space-y-1">
                      <Input
                        type="text"
                        placeholder="Address"
                        value={current.resolution.address}
                        onChange={(e) =>
                          updateCurrentDraft({ resolution: { ...current.resolution, address: e.target.value } as CustomerResolution })
                        }
                        className="w-full"
                      />
                      <p className="font-sans text-xs text-muted">
                        Zone: {current.resolution.address ? deriveZoneFromAddress(current.resolution.address) : "—"}
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
              <Input type="date" value={current.deliveryDate} onChange={(e) => updateCurrentDraft({ deliveryDate: e.target.value })} />
            </label>
            <label className="flex flex-1 min-w-48 flex-col gap-1">
              <span className="font-sans text-sm text-muted">Notes</span>
              <Input type="text" value={current.notes} onChange={(e) => updateCurrentDraft({ notes: e.target.value })} className="w-full" />
            </label>
          </div>

          <Card elevated className="!space-y-0 !p-1">
            {current.lines.map((line, index) => {
              const isNote = line.uiResolution === "note";
              const ok = !isNote && lineIsOk(line);
              const productName = line.productId ? (productNameById.get(line.productId) ?? line.rawText) : line.rawText;
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
            onClick={handleSaveCurrent}
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
              {sheetLine.productId ? (productNameById.get(sheetLine.productId) ?? sheetLine.rawText) : sheetLine.rawText}
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

            <div className="flex items-center gap-3 text-sm">
              <label className="flex items-center gap-1.5 font-sans text-[13px] font-semibold">
                <input type="radio" checked={mapMode === "existing"} onChange={() => setMapMode("existing")} />
                Existing product
              </label>
              <label className="flex items-center gap-1.5 font-sans text-[13px] font-semibold">
                <input type="radio" checked={mapMode === "new"} onChange={() => setMapMode("new")} />
                New product
              </label>
            </div>

            {mapMode === "existing" ? (
              <Select value={mapProductId ?? ""} onChange={(e) => setMapProductId(e.target.value || null)} className="w-full">
                <option value="">Select product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            ) : (
              <div className="space-y-2">
                <Input
                  type="text"
                  placeholder="Product name"
                  value={newProductName}
                  onChange={(e) => setNewProductName(e.target.value)}
                  className="w-full"
                />
                <div className="flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-1.5 font-sans text-[13px] font-semibold">
                    <input
                      type="radio"
                      checked={newProductUnitType === "weight"}
                      onChange={() => {
                        setNewProductUnitType("weight");
                        setNewProductUnitLabel("kg");
                      }}
                    />
                    Weight
                  </label>
                  <label className="flex items-center gap-1.5 font-sans text-[13px] font-semibold">
                    <input
                      type="radio"
                      checked={newProductUnitType === "count"}
                      onChange={() => {
                        setNewProductUnitType("count");
                        setNewProductUnitLabel("piece");
                      }}
                    />
                    Count
                  </label>
                </div>
                <Input
                  type="text"
                  placeholder="Unit label (kg, dozen, piece…)"
                  value={newProductUnitLabel}
                  onChange={(e) => setNewProductUnitLabel(e.target.value)}
                  className="w-full"
                />
                {mapError && <FormError>{mapError}</FormError>}
              </div>
            )}

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
            <Button
              variant="primary"
              fullWidth
              disabled={mapMode === "existing" ? !mapProductId : !newProductName.trim() || !newProductUnitLabel.trim()}
              onClick={saveMapSheet}
              pending={mapSaving}
              pendingText="Creating…"
            >
              Save
            </Button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
