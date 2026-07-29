"use client";

import { useOptimistic, useState, useTransition } from "react";
import { toggleProcurementItemCheck } from "@/app/actions/procurement";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FormError } from "@/components/ui/form-error";
import { cn } from "@/lib/cn";
import type { ProcurementContribution } from "@/lib/procurement/aggregate";

export interface ProcurementDisplayRow {
  productId: string;
  name: string;
  unitLabel: string | null;
  totalQty: number;
  extraQty: number;
  contributions: ProcurementContribution[];
  checked: boolean;
}

function contributionsText(contributions: ProcurementContribution[]): string {
  return contributions.map((c) => `${c.customerName} ${c.qty}`).join(", ");
}

export function ProcurementChecklist({ date, rows }: { date: string; rows: ProcurementDisplayRow[] }) {
  const [checked, setChecked] = useOptimistic(
    new Set(rows.filter((r) => r.checked).map((r) => r.productId)),
    (state, update: { productId: string; checked: boolean }) => {
      const next = new Set(state);
      if (update.checked) next.add(update.productId);
      else next.delete(update.productId);
      return next;
    },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  function handleToggle(row: ProcurementDisplayRow, next: boolean) {
    setErrors((prev) => ({ ...prev, [row.productId]: "" }));
    startTransition(async () => {
      setChecked({ productId: row.productId, checked: next });
      const result = await toggleProcurementItemCheck(date, row.productId, next, row.totalQty);
      if (!result.ok) {
        setChecked({ productId: row.productId, checked: !next });
        setErrors((prev) => ({ ...prev, [row.productId]: result.error }));
      }
    });
  }

  if (rows.length === 0) {
    return <p className="font-sans text-sm text-muted">Nothing to procure for this date.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const isChecked = checked.has(row.productId);
        return (
          <div key={row.productId} className="flex flex-col gap-1">
            <Card
              elevated={!isChecked}
              className={cn("flex items-center gap-3 !space-y-0", isChecked && "opacity-60")}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={(e) => handleToggle(row, e.target.checked)}
                className="size-4 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "font-sans text-sm font-bold",
                    isChecked ? "text-muted" : "text-foreground",
                  )}
                >
                  {row.name}
                </div>
                {row.contributions.length > 0 && (
                  <div className="truncate font-sans text-[11.5px] font-semibold text-muted">
                    {contributionsText(row.contributions)}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <div className="font-sans text-[12.5px] font-semibold text-muted">
                  {row.totalQty} {row.unitLabel ?? ""}
                </div>
                {row.extraQty > 0 && (
                  <Badge tone="warning" size="sm" key={row.extraQty}>
                    +{row.extraQty} new
                  </Badge>
                )}
              </div>
            </Card>
            {errors[row.productId] && <FormError>{errors[row.productId]}</FormError>}
          </div>
        );
      })}
    </div>
  );
}
