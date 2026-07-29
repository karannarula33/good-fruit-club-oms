"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseOrderDraft, saveOrder, type DraftLine, type SaveOrderLine } from "@/app/actions/orders";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { deriveZoneFromAddress } from "@/lib/customers/zone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-error";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

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
}

export function OrderPasteReview({
  customers,
  products,
}: {
  customers: CustomerOption[];
  products: ProductOption[];
}) {
  const router = useRouter();

  const [step, setStep] = useState<Step>("paste");
  const [rawText, setRawText] = useState("");
  const [placedAtLocal, setPlacedAtLocal] = useState(() => utcToIstDatetimeLocal(new Date()));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customerNameText, setCustomerNameText] = useState("");
  const [customerMatchConfidence, setCustomerMatchConfidence] = useState<"clean" | "flagged">("clean");
  const [resolution, setResolution] = useState<CustomerResolution>({ mode: "new", displayName: "", phone: "", address: "" });
  const [deliveryDate, setDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);

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
    setDeliveryDate(derivedDate);
    setNotes(parsedNotes);
    setLines(
      draftLines.map((line) => ({
        ...line,
        originalProductId: line.productId,
        rememberAlias: line.productId === null,
        aliasText: line.rawText,
      })),
    );
    setStep("review");
  }

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  const customerResolved =
    resolution.mode === "new"
      ? resolution.displayName.trim() !== "" && resolution.address.trim() !== ""
      : true;
  const canSave =
    customerResolved &&
    lines.length > 0 &&
    lines.every((line) => line.productId && Number.isFinite(line.qty) && (line.qty ?? 0) > 0);
  const unresolvedLineCount = lines.filter(
    (line) => !line.productId || !Number.isFinite(line.qty) || (line.qty ?? 0) <= 0,
  ).length;
  const unpricedLineCount = lines.filter((line) => line.productId && line.resolvedPrice === null).length;

  async function handleSave() {
    setError(null);
    setPending(true);

    const saveLines: SaveOrderLine[] = lines.map((line) => ({
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
      newAliases: lines
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
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {step === "paste" && (
        <form onSubmit={handleParse} className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm text-neutral-600 dark:text-neutral-400">Paste the customer&apos;s order</span>
            <textarea
              required
              rows={10}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand"
              placeholder={"Rita Parkash\n2 dozen kela\n1 kg papaya"}
            />
          </label>
          <label className="block space-y-1 max-w-xs">
            <span className="text-sm text-neutral-600 dark:text-neutral-400">Placed at (IST)</span>
            <Input
              type="datetime-local"
              value={placedAtLocal}
              onChange={(e) => setPlacedAtLocal(e.target.value)}
              className="w-full"
            />
          </label>
          {error && <FormError>{error}</FormError>}
          <Button type="submit" pending={pending} pendingText="Parsing…">
            Parse
          </Button>
        </form>
      )}

      {step === "review" && (
        <div className="space-y-4">
          <Card>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Customer</span>
              {customerMatchConfidence === "flagged" && (
                <span className="text-xs text-danger-text">Flagged — please confirm</span>
              )}
              <span className="text-xs text-neutral-500">(parsed as &quot;{customerNameText}&quot;)</span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={resolution.mode === "matched" || resolution.mode === "existing"}
                  onChange={() =>
                    setResolution({ mode: "existing", customerId: customers[0]?.id ?? "" })
                  }
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

            <div className="flex items-center gap-2 text-sm">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={resolution.mode === "new"}
                  onChange={() =>
                    setResolution({ mode: "new", displayName: customerNameText, phone: "", address: "" })
                  }
                />
                New customer
              </label>
            </div>

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
                  <p className="text-xs text-neutral-500">
                    Zone: {resolution.address ? deriveZoneFromAddress(resolution.address) : "—"}
                  </p>
                </div>
              </div>
            )}
          </Card>

          <div className="flex flex-wrap gap-4">
            <label className="block space-y-1">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">Delivery date</span>
              <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </label>
            <label className="block flex-1 min-w-48 space-y-1">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">Notes</span>
              <Input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full" />
            </label>
          </div>

          <Table>
            <THead>
              <TR>
                <TH>Raw text</TH>
                <TH>Product</TH>
                <TH>Qty</TH>
                <TH>Unit</TH>
                <TH>Price</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {lines.map((line, index) => {
                const needsMapping = line.originalProductId === null;
                return (
                  <TR key={index} className="align-top">
                    <TD className="text-neutral-600 dark:text-neutral-400 max-w-xs">{line.rawText}</TD>
                    <TD>
                      {needsMapping ? (
                        <div className="space-y-1">
                          <Select
                            value={line.productId ?? ""}
                            onChange={(e) => updateLine(index, { productId: e.target.value || null })}
                          >
                            <option value="">Select product…</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </Select>
                          {line.productId && (
                            <label className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
                              <input
                                type="checkbox"
                                checked={line.rememberAlias}
                                onChange={(e) => updateLine(index, { rememberAlias: e.target.checked })}
                              />
                              Remember &quot;{line.aliasText}&quot; as {productNameById.get(line.productId)}
                            </label>
                          )}
                        </div>
                      ) : (
                        <span>{productNameById.get(line.productId as string) ?? "Unknown"}</span>
                      )}
                    </TD>
                    <TD>
                      <Input
                        className="w-20"
                        type="number"
                        step="0.001"
                        min="0"
                        value={line.qty ?? ""}
                        onChange={(e) =>
                          updateLine(index, { qty: e.target.value === "" ? null : Number(e.target.value) })
                        }
                      />
                    </TD>
                    <TD>
                      <Input
                        className="w-20"
                        type="text"
                        value={line.unit ?? ""}
                        onChange={(e) => updateLine(index, { unit: e.target.value || null })}
                      />
                    </TD>
                    <TD>
                      {line.resolvedPrice !== null ? (
                        `₹${line.resolvedPrice.toFixed(2)}`
                      ) : (
                        <span className="text-danger-text">No price</span>
                      )}
                    </TD>
                    <TD>
                      {line.confidence === "clean" ? (
                        <span className="text-sm text-neutral-500">Clean</span>
                      ) : (
                        <span className="text-sm text-danger-text">{line.flagReason ?? "Flagged"}</span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>

          {error && <FormError>{error}</FormError>}
          {!canSave && (
            <FormError>
              {unresolvedLineCount > 0
                ? `${unresolvedLineCount} line${unresolvedLineCount === 1 ? "" : "s"} still need a product and quantity.`
                : "Resolve the customer before saving."}
            </FormError>
          )}
          {canSave && unpricedLineCount > 0 && (
            <FormError>
              {unpricedLineCount} line{unpricedLineCount === 1 ? "" : "s"} have no price — order can be saved but
              cannot be billed until priced.
            </FormError>
          )}

          <div className="flex gap-3 items-center">
            <Button onClick={handleSave} disabled={!canSave} pending={pending} pendingText="Saving…">
              Save order
            </Button>
            <Button variant="ghost" onClick={() => setStep("paste")}>
              Back to paste
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
