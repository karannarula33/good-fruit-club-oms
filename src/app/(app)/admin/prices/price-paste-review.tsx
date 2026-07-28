"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parsePriceListDraft, publishPriceVersion, type ReviewLine } from "@/app/actions/prices";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";

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
            <span className="text-sm text-neutral-600">Paste today&apos;s price list</span>
            <textarea
              required
              rows={12}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono"
              placeholder={"Chausa Mango: ₹295 / KG\nBanarsi Langda Mango: ₹225 / KG\n..."}
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-50"
          >
            {pending ? "Parsing..." : "Parse"}
          </button>
        </form>
      )}

      {step === "review" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <label className="block space-y-1">
              <span className="text-sm text-neutral-600">Effective from (IST)</span>
              <input
                type="datetime-local"
                value={effectiveFromLocal}
                onChange={(e) => setEffectiveFromLocal(e.target.value)}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block flex-1 min-w-48 space-y-1">
              <span className="text-sm text-neutral-600">Note (optional)</span>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                placeholder="Morning list"
              />
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border border-neutral-300 rounded-md">
              <thead>
                <tr className="bg-neutral-100 text-left">
                  <th className="px-3 py-2">Raw text</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Price</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const needsMapping = line.originalProductId === null;
                  return (
                    <tr key={index} className="border-t border-neutral-200 align-top">
                      <td className="px-3 py-2 text-neutral-600 max-w-xs">{line.rawText}</td>
                      <td className="px-3 py-2">
                        {needsMapping ? (
                          <div className="space-y-1">
                            <select
                              value={line.productId ?? ""}
                              onChange={(e) => updateLine(index, { productId: e.target.value || null })}
                              className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
                            >
                              <option value="">Select product…</option>
                              {catalog.map((product) => (
                                <option key={product.id} value={product.id}>
                                  {product.name}
                                </option>
                              ))}
                            </select>
                            {line.productId && (
                              <label className="flex items-center gap-1 text-xs text-neutral-600">
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
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.price ?? ""}
                          onChange={(e) =>
                            updateLine(index, { price: e.target.value === "" ? null : Number(e.target.value) })
                          }
                          className="w-24 rounded-md border border-neutral-300 px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        {line.confidence === "clean" ? (
                          <span className="text-sm text-neutral-500">Clean</span>
                        ) : (
                          <span className="text-sm text-red-600">{line.flagReason ?? "Flagged"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {!canPublish && (
            <p className="text-sm text-red-600">
              {unresolvedCount} line{unresolvedCount === 1 ? "" : "s"} still need a product and a price.
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handlePublish}
              disabled={pending || !canPublish}
              className="rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-50"
            >
              {pending ? "Publishing..." : "Publish"}
            </button>
            <button
              type="button"
              onClick={() => setStep("paste")}
              className="text-sm text-neutral-500"
            >
              Back to paste
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
