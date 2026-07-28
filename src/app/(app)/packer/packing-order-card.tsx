"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackageCheck, Ban, MessageCircle } from "lucide-react";
import { finalizeOrder } from "@/app/actions/packing";
import { generateBill } from "@/app/actions/bills";
import { toWhatsAppDigits } from "@/lib/phone";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/ui/form-error";
import { cn } from "@/lib/cn";
import type { UnitType } from "@/lib/supabase/database.types";

interface LineForPacking {
  id: string;
  productId: string;
  productName: string;
  unitType: UnitType;
  unitLabel: string | null;
  orderedQty: number | null;
  orderedUnit: string | null;
}

interface OrderForPacking {
  id: string;
  customerName: string;
  zone: string;
  lines: LineForPacking[];
}

type Resolution = "pending" | "packed" | "unavailable";

interface LineState {
  resolution: Resolution;
  actualQty: string;
  addSubstitute: boolean;
  substituteProductId: string;
  substituteQty: string;
}

function initialLineState(): LineState {
  return { resolution: "pending", actualQty: "", addSubstitute: false, substituteProductId: "", substituteQty: "" };
}

export function PackingOrderCard({
  order,
  products,
}: {
  order: OrderForPacking;
  products: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lineStates, setLineStates] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(order.lines.map((line) => [line.id, initialLineState()])),
  );
  const [stage, setStage] = useState<"packing" | "billed" | "bill-blocked">("packing");
  const [bill, setBill] = useState<{ messageText: string; customerPhone: string | null } | null>(null);
  const [unpricedLineCount, setUnpricedLineCount] = useState(0);

  function updateLine(lineId: string, patch: Partial<LineState>) {
    setLineStates((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  }

  const pendingLines = order.lines.filter((line) => lineStates[line.id]?.resolution === "pending");
  const invalidPackedLines = order.lines.filter((line) => {
    const state = lineStates[line.id];
    return state.resolution === "packed" && !(Number(state.actualQty) > 0);
  });
  const invalidSubstituteLines = order.lines.filter((line) => {
    const state = lineStates[line.id];
    return (
      state.resolution === "unavailable" &&
      state.addSubstitute &&
      !(state.substituteProductId !== "" && Number(state.substituteQty) > 0)
    );
  });
  const canFinalize =
    pendingLines.length === 0 && invalidPackedLines.length === 0 && invalidSubstituteLines.length === 0;

  function handleFinalize() {
    setError(null);
    startTransition(async () => {
      const resolutions = order.lines.map((line) => {
        const state = lineStates[line.id];
        return {
          lineId: line.id,
          resolution: state.resolution as "packed" | "unavailable",
          actualQty: state.resolution === "packed" ? Number(state.actualQty) : null,
        };
      });
      const substitutions = order.lines
        .filter((line) => lineStates[line.id].resolution === "unavailable" && lineStates[line.id].addSubstitute)
        .map((line) => ({
          substitutedForLineId: line.id,
          productId: lineStates[line.id].substituteProductId,
          actualQty: Number(lineStates[line.id].substituteQty),
        }));

      const result = await finalizeOrder(order.id, resolutions, substitutions);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await runGenerateBill();
    });
  }

  async function runGenerateBill() {
    const billResult = await generateBill(order.id);
    if (!billResult.ok) {
      if (billResult.reason === "unpriced") {
        setUnpricedLineCount(billResult.unpricedLineCount);
        setStage("bill-blocked");
      } else {
        setError(billResult.error);
      }
      return;
    }
    setBill({ messageText: billResult.messageText, customerPhone: billResult.customerPhone });
    setStage("billed");
  }

  function handleRetryBill() {
    setError(null);
    startTransition(runGenerateBill);
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{order.customerName}</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{order.zone}</p>
      </div>

      {stage === "packing" && (
        <div className="space-y-3">
          {order.lines.map((line) => {
            const state = lineStates[line.id];
            return (
              <div key={line.id} className="border-t border-neutral-200 dark:border-neutral-800 pt-3 space-y-2">
                <div>
                  <p className="font-medium">{line.productName}</p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">
                    Ordered: {line.orderedQty ?? "—"} {line.orderedUnit ?? line.unitLabel ?? ""}
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant={state.resolution === "packed" ? "primary" : "secondary"}
                    size="lg"
                    fullWidth
                    onClick={() => updateLine(line.id, { resolution: "packed" })}
                  >
                    <PackageCheck className="size-4" aria-hidden="true" />
                    Packed
                  </Button>
                  <Button
                    variant={state.resolution === "unavailable" ? "destructive" : "secondary"}
                    size="lg"
                    fullWidth
                    onClick={() => updateLine(line.id, { resolution: "unavailable" })}
                  >
                    <Ban className="size-4" aria-hidden="true" />
                    Unavailable
                  </Button>
                </div>

                {state.resolution === "packed" && (
                  <Input
                    size="lg"
                    type="number"
                    inputMode={line.unitType === "weight" ? "decimal" : "numeric"}
                    step={line.unitType === "weight" ? "0.001" : "1"}
                    min="0"
                    placeholder={`Actual ${line.unitLabel ?? ""}`}
                    value={state.actualQty}
                    onChange={(e) => updateLine(line.id, { actualQty: e.target.value })}
                    className="w-full"
                  />
                )}

                {state.resolution === "unavailable" && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                      <input
                        type="checkbox"
                        checked={state.addSubstitute}
                        onChange={(e) => updateLine(line.id, { addSubstitute: e.target.checked })}
                      />
                      Add substitute
                    </label>
                    {state.addSubstitute && (
                      <div className="flex gap-2">
                        <Select
                          className="flex-1"
                          value={state.substituteProductId}
                          onChange={(e) => updateLine(line.id, { substituteProductId: e.target.value })}
                        >
                          <option value="">Select product…</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </Select>
                        <Input
                          className="w-24"
                          type="number"
                          step="0.001"
                          min="0"
                          placeholder="Qty"
                          value={state.substituteQty}
                          onChange={(e) => updateLine(line.id, { substituteQty: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && <FormError>{error}</FormError>}

      {stage === "packing" && (
        <>
          {!canFinalize && (
            <div className="text-sm text-danger-text space-y-0.5">
              {pendingLines.length > 0 && (
                <p>
                  {pendingLines.length} line{pendingLines.length === 1 ? "" : "s"} still need Packed or Unavailable:{" "}
                  {pendingLines.map((l) => l.productName).join(", ")}
                </p>
              )}
              {invalidPackedLines.length > 0 && (
                <p>
                  Enter a quantity greater than zero for: {invalidPackedLines.map((l) => l.productName).join(", ")}
                </p>
              )}
              {invalidSubstituteLines.length > 0 && (
                <p>
                  Finish the substitute (product + qty) for:{" "}
                  {invalidSubstituteLines.map((l) => l.productName).join(", ")}
                </p>
              )}
            </div>
          )}

          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={handleFinalize}
            disabled={!canFinalize}
            pending={pending}
            pendingText="Finalizing…"
          >
            Finalize order
          </Button>
        </>
      )}

      {stage === "bill-blocked" && (
        <div className="space-y-3">
          <p className="text-sm text-danger-text">
            Order packed, but the bill couldn&apos;t be generated: {unpricedLineCount} item
            {unpricedLineCount === 1 ? "" : "s"} still need a price. Ask admin to price them in Prices, then retry.
          </p>
          <Button variant="primary" size="lg" fullWidth onClick={handleRetryBill} pending={pending} pendingText="Retrying…">
            Retry generating bill
          </Button>
        </div>
      )}

      {stage === "billed" && bill && (
        <div className="space-y-3">
          <p className="text-sm text-neutral-700 dark:text-neutral-300">Order packed and billed.</p>
          {bill.customerPhone ? (
            <a
              href={`https://wa.me/${toWhatsAppDigits(bill.customerPhone)}?text=${encodeURIComponent(bill.messageText)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "flex items-center justify-center gap-2 w-full rounded-md px-4 py-3 text-lg font-medium text-white",
                "bg-success hover:brightness-95",
              )}
            >
              <MessageCircle className="size-5" aria-hidden="true" />
              Send bill on WhatsApp
            </a>
          ) : (
            <FormError>No phone number on file for this customer — send the bill manually.</FormError>
          )}
          <Button variant="secondary" size="lg" fullWidth onClick={() => router.refresh()}>
            Done
          </Button>
        </div>
      )}
    </Card>
  );
}
