"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parsePriceListDraft, publishPriceVersion, type ReviewLine } from "@/app/actions/prices";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/ui/form-error";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

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
}

export function PricePasteReview({ catalog }: { catalog: CatalogProduct[] }) {
  const router = useRouter();

  const [step, setStep] = useState<Step>("paste");
  const [rawText, setRawText] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [effectiveFromLocal, setEffectiveFromLocal] = useState(() => utcToIstDatetimeLocal(new Date()));
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productNameById = new Map(catalog.map((product) => [product.id, product.name]));

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
      })),
    );
    setStep("review");
  }

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
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
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Publish a price list</h2>

      {step === "paste" && (
        <form onSubmit={handleParse} className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm text-neutral-600 dark:text-neutral-400">Paste today&apos;s price list</span>
            <textarea
              required
              rows={12}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand"
              placeholder={"Chausa Mango: ₹295 / KG\nBanarsi Langda Mango: ₹225 / KG\n..."}
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
          <div className="flex flex-wrap gap-4">
            <label className="block space-y-1">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">Effective from (IST)</span>
              <Input
                type="datetime-local"
                value={effectiveFromLocal}
                onChange={(e) => setEffectiveFromLocal(e.target.value)}
              />
            </label>
            <label className="block flex-1 min-w-48 space-y-1">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">Note (optional)</span>
              <Input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full"
                placeholder="Morning list"
              />
            </label>
          </div>

          <Table>
            <THead>
              <TR>
                <TH>Raw text</TH>
                <TH>Product</TH>
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
                            {catalog.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.name}
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
                        className="w-24"
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.price ?? ""}
                        onChange={(e) =>
                          updateLine(index, { price: e.target.value === "" ? null : Number(e.target.value) })
                        }
                      />
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
          {!canPublish && (
            <FormError>
              {unresolvedCount} line{unresolvedCount === 1 ? "" : "s"} still need a product and a price.
            </FormError>
          )}

          <div className="flex gap-3 items-center">
            <Button onClick={handlePublish} disabled={!canPublish} pending={pending} pendingText="Publishing…">
              Publish
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
