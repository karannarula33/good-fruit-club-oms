"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finalizeOrder } from "@/app/actions/packing";
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

  function updateLine(lineId: string, patch: Partial<LineState>) {
    setLineStates((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  }

  const allResolved = order.lines.every((line) => lineStates[line.id]?.resolution !== "pending");
  const packedQtysValid = order.lines.every((line) => {
    const state = lineStates[line.id];
    if (state.resolution !== "packed") return true;
    return Number(state.actualQty) > 0;
  });
  const substituteInputsValid = order.lines.every((line) => {
    const state = lineStates[line.id];
    if (state.resolution !== "unavailable" || !state.addSubstitute) return true;
    return state.substituteProductId !== "" && Number(state.substituteQty) > 0;
  });
  const canFinalize = allResolved && packedQtysValid && substituteInputsValid;

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
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-neutral-300 p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{order.customerName}</h2>
        <p className="text-sm text-neutral-600">{order.zone}</p>
      </div>

      <div className="space-y-3">
        {order.lines.map((line) => {
          const state = lineStates[line.id];
          return (
            <div key={line.id} className="border-t border-neutral-200 pt-3 space-y-2">
              <div>
                <p className="font-medium">{line.productName}</p>
                <p className="text-sm text-neutral-600">
                  Ordered: {line.orderedQty ?? "—"} {line.orderedUnit ?? line.unitLabel ?? ""}
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => updateLine(line.id, { resolution: "packed" })}
                  className={`flex-1 rounded-md px-3 py-3 text-sm font-medium ${
                    state.resolution === "packed" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700"
                  }`}
                >
                  Packed
                </button>
                <button
                  type="button"
                  onClick={() => updateLine(line.id, { resolution: "unavailable" })}
                  className={`flex-1 rounded-md px-3 py-3 text-sm font-medium ${
                    state.resolution === "unavailable" ? "bg-red-700 text-white" : "bg-neutral-100 text-neutral-700"
                  }`}
                >
                  Unavailable
                </button>
              </div>

              {state.resolution === "packed" && (
                <input
                  type="number"
                  inputMode={line.unitType === "weight" ? "decimal" : "numeric"}
                  step={line.unitType === "weight" ? "0.001" : "1"}
                  min="0"
                  placeholder={`Actual ${line.unitLabel ?? ""}`}
                  value={state.actualQty}
                  onChange={(e) => updateLine(line.id, { actualQty: e.target.value })}
                  className="w-full rounded-md border border-neutral-300 px-3 py-3 text-lg"
                />
              )}

              {state.resolution === "unavailable" && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-neutral-600">
                    <input
                      type="checkbox"
                      checked={state.addSubstitute}
                      onChange={(e) => updateLine(line.id, { addSubstitute: e.target.checked })}
                    />
                    Add substitute
                  </label>
                  {state.addSubstitute && (
                    <div className="flex gap-2">
                      <select
                        value={state.substituteProductId}
                        onChange={(e) => updateLine(line.id, { substituteProductId: e.target.value })}
                        className="flex-1 rounded-md border border-neutral-300 px-2 py-2 text-sm"
                      >
                        <option value="">Select product…</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        placeholder="Qty"
                        value={state.substituteQty}
                        onChange={(e) => updateLine(line.id, { substituteQty: e.target.value })}
                        className="w-24 rounded-md border border-neutral-300 px-2 py-2 text-sm"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={handleFinalize}
        disabled={pending || !canFinalize}
        className="w-full rounded-md bg-neutral-900 px-4 py-3 text-lg text-white disabled:opacity-50"
      >
        {pending ? "Finalizing..." : "Finalize order"}
      </button>
    </div>
  );
}
