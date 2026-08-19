"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { parsePriceListDraft, publishPriceVersion, type ReviewLine } from "@/app/actions/prices";
import { createProduct } from "@/app/actions/products";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-error";
import { useToast } from "@/components/ui/toast";

type Step = "paste" | "review";

interface CatalogProduct {
  id: string;
  name: string;
  aliases: string[];
}

interface Line extends ReviewLine {
  originalProductId: string | null;
  rememberAlias: boolean;
  aliasText: string;
  addingProduct: boolean;
  newProductName: string;
  newProductUnitType: "weight" | "count";
  newProductUnitLabel: string;
}

const NEW_PRODUCT_OPTION = "__new__";

export function PricePasteReview({ catalog }: { catalog: CatalogProduct[] }) {
  const router = useRouter();
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>("paste");
  const [rawText, setRawText] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [localCatalog, setLocalCatalog] = useState<CatalogProduct[]>(catalog);
  const [effectiveFromLocal, setEffectiveFromLocal] = useState(() => utcToIstDatetimeLocal(new Date()));
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addProductError, setAddProductError] = useState<Record<number, string>>({});
  const [addProductPending, setAddProductPending] = useState<number | null>(null);

  const productNameById = new Map(localCatalog.map((product) => [product.id, product.name]));

  async function handleParse(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await parsePriceListDraft(rawText);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLines(
      result.lines.map((line) => ({
        ...line,
        originalProductId: line.productId,
        rememberAlias: line.productId === null,
        aliasText: line.rawText,
        addingProduct: false,
        newProductName: line.rawText,
        newProductUnitType: "weight",
        newProductUnitLabel: "",
      })),
    );
    setStep("review");
  }

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function handleAddNewProduct(index: number) {
    const line = lines[index];
    setAddProductError((prev) => ({ ...prev, [index]: "" }));
    setAddProductPending(index);
    const result = await createProduct({
      name: line.newProductName,
      unitType: line.newProductUnitType,
      unitLabel: line.newProductUnitLabel,
    });
    setAddProductPending(null);
    if (!result.ok) {
      setAddProductError((prev) => ({ ...prev, [index]: result.error }));
      return;
    }
    setLocalCatalog((prev) => [...prev, { id: result.product.id, name: result.product.name, aliases: [] }]);
    updateLine(index, { productId: result.product.id, addingProduct: false });
    showToast(`${result.product.name} added ✓`);
  }

  const canPublish =
    lines.length > 0 &&
    lines.every((line) => line.productId && Number.isFinite(line.price) && (line.price ?? 0) > 0);
  const unresolvedCount = lines.filter(
    (line) => !line.productId || !Number.isFinite(line.price) || (line.price ?? 0) <= 0,
  ).length;

  async function handlePublish() {
    setError(null);
    setPending(true);
    const result = await publishPriceVersion({
      effectiveFromIst: effectiveFromLocal,
      note: note.trim() || null,
      items: lines.map((line) => ({ productId: line.productId as string, pricePerUnit: line.price as number })),
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
    setNote("");
    setEffectiveFromLocal(utcToIstDatetimeLocal(new Date()));
    showToast("Prices published ✓");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {step === "paste" && (
        <form onSubmit={handleParse} className="flex flex-col gap-3">
          <textarea
            required
            rows={9}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste vendor price message here…"
            className="w-full rounded-2xl border-[1.5px] border-[#ECEAE3] bg-[#F1F1EE] p-3.5 font-sans text-[14.5px] font-medium leading-[1.55] text-foreground focus:outline-none"
          />
          {error && <FormError>{error}</FormError>}
          <Button type="submit" variant="dark" fullWidth pending={pending} pendingText="Parsing…">
            Parse Prices
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
            <span className="font-sans text-[13.5px] font-bold text-foreground">Review Prices</span>
            <span className="w-11" />
          </div>

          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-sans text-sm text-muted">Effective from (IST)</span>
              <Input type="datetime-local" value={effectiveFromLocal} onChange={(e) => setEffectiveFromLocal(e.target.value)} />
            </label>
            <label className="flex flex-1 min-w-48 flex-col gap-1">
              <span className="font-sans text-sm text-muted">Note (optional)</span>
              <Input type="text" value={note} onChange={(e) => setNote(e.target.value)} className="w-full" placeholder="Morning list" />
            </label>
          </div>

          <div className="flex flex-col gap-2">
            {lines.map((line, index) => {
              const needsMapping = line.originalProductId === null;
              return (
                <Card key={index} elevated className="flex items-center justify-between gap-3 !space-y-0">
                  <div className="min-w-0 flex-1">
                    {needsMapping ? (
                      <div className="space-y-1.5">
                        <div className="font-sans text-xs text-muted">&quot;{line.rawText}&quot;</div>
                        {!line.addingProduct && (
                          <Select
                            value={line.productId ?? ""}
                            onChange={(e) => {
                              if (e.target.value === NEW_PRODUCT_OPTION) {
                                updateLine(index, { addingProduct: true, productId: null });
                                return;
                              }
                              updateLine(index, { productId: e.target.value || null });
                            }}
                          >
                            <option value="">Select product…</option>
                            {localCatalog.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.name}
                              </option>
                            ))}
                            <option value={NEW_PRODUCT_OPTION}>+ Add new product…</option>
                          </Select>
                        )}
                        {line.addingProduct && (
                          <div className="flex flex-col gap-1.5 rounded-xl bg-neutral-bg p-2.5">
                            <Input
                              type="text"
                              value={line.newProductName}
                              onChange={(e) => updateLine(index, { newProductName: e.target.value })}
                              placeholder="Product name"
                            />
                            <div className="flex gap-1.5">
                              <Select
                                className="flex-1"
                                value={line.newProductUnitType}
                                onChange={(e) =>
                                  updateLine(index, { newProductUnitType: e.target.value as "weight" | "count" })
                                }
                              >
                                <option value="weight">Weight</option>
                                <option value="count">Count</option>
                              </Select>
                              <Input
                                className="flex-1"
                                type="text"
                                value={line.newProductUnitLabel}
                                onChange={(e) => updateLine(index, { newProductUnitLabel: e.target.value })}
                                placeholder="kg, dozen…"
                              />
                            </div>
                            {addProductError[index] && <FormError>{addProductError[index]}</FormError>}
                            <div className="flex gap-1.5">
                              <Button
                                size="sm"
                                variant="dark"
                                pending={addProductPending === index}
                                pendingText="Adding…"
                                onClick={() => handleAddNewProduct(index)}
                              >
                                Create product
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => updateLine(index, { addingProduct: false })}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}
                        {line.productId && (
                          <label className="flex items-center gap-1 font-sans text-xs font-semibold text-muted">
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
                      <div className="font-sans text-sm font-bold text-foreground">
                        {productNameById.get(line.productId as string) ?? "Unknown"}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="font-sans text-sm font-bold text-muted">₹</span>
                    <Input
                      className="w-[70px] text-center"
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.price ?? ""}
                      onChange={(e) => updateLine(index, { price: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </div>
                </Card>
              );
            })}
          </div>

          {error && <FormError>{error}</FormError>}
          {!canPublish && (
            <FormError>
              {unresolvedCount} line{unresolvedCount === 1 ? "" : "s"} still need a product and a price.
            </FormError>
          )}

          <Button variant="primary" fullWidth disabled={!canPublish} onClick={handlePublish} pending={pending} pendingText="Publishing…">
            Publish Prices
          </Button>
        </div>
      )}
    </div>
  );
}
