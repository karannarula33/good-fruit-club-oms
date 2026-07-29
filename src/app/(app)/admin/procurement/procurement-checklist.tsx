"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, MessageCircle } from "lucide-react";
import { markProcurementItemsSent } from "@/app/actions/procurement";
import { buildProcurementMessage } from "@/lib/procurement/message";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { FormError } from "@/components/ui/form-error";
import { useToast } from "@/components/ui/toast";
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
  const router = useRouter();
  const { showToast } = useToast();

  const [sent, setSent] = useOptimistic(
    new Set(rows.filter((r) => r.checked && r.extraQty === 0).map((r) => r.productId)),
    (state, ids: string[]) => new Set([...state, ...ids]),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);

  function toggleSelected(productId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(productId);
      else next.delete(productId);
      return next;
    });
  }

  const selectedRows = rows.filter((row) => selected.has(row.productId));

  function handleMarkSent() {
    setError(null);
    const items = selectedRows.map((row) => ({ productId: row.productId, qty: row.totalQty }));
    const ids = items.map((i) => i.productId);
    startTransition(async () => {
      setSent(ids);
      const result = await markProcurementItemsSent(date, items);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSelected(new Set());
      showToast("Marked sent to vendor ✓");
      router.refresh();
    });
  }

  function openPreview() {
    const text = buildProcurementMessage(
      date,
      selectedRows.map((row) => ({ name: row.name, qty: row.totalQty, unitLabel: row.unitLabel })),
    );
    setPreviewText(text);
  }

  function handleCopy() {
    if (!previewText) return;
    navigator.clipboard.writeText(previewText).catch(() => {});
    showToast("Copied ✓");
  }

  if (rows.length === 0) {
    return <p className="font-sans text-sm text-muted">Nothing to procure for this date.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {rows.map((row) => {
          const isSent = sent.has(row.productId) || (row.checked && row.extraQty === 0);
          const isSelected = selected.has(row.productId);
          return (
            <Card
              key={row.productId}
              elevated={!isSent}
              className={cn("flex items-center gap-3 !space-y-0", isSent && "opacity-60")}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={(e) => toggleSelected(row.productId, e.target.checked)}
                className="size-4 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className={cn("font-sans text-sm font-bold", isSent ? "text-muted" : "text-foreground")}>
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
                {isSent && row.extraQty === 0 && (
                  <Badge tone="success" size="sm">
                    <Check className="size-3" aria-hidden="true" /> Sent
                  </Badge>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <Button
          variant="dark"
          fullWidth
          onClick={handleMarkSent}
          disabled={selected.size === 0}
          pending={pending}
          pendingText="Marking…"
        >
          Mark sent to vendor{selected.size > 0 ? ` (${selected.size})` : ""}
        </Button>
        <Button variant="outline" fullWidth onClick={openPreview} disabled={selected.size === 0}>
          <MessageCircle className="size-5" aria-hidden="true" />
          WhatsApp message
        </Button>
        {error && <FormError>{error}</FormError>}
      </div>

      <BottomSheet open={previewText !== null} onClose={() => setPreviewText(null)}>
        <div className="flex flex-col gap-3">
          <div className="font-sans text-[11px] font-bold uppercase tracking-wide text-muted">
            Procurement message
          </div>
          <div className="rounded-2xl rounded-bl-[4px] bg-[#DCF3D5] p-4">
            <div className="whitespace-pre-wrap font-sans text-[13.5px] leading-[1.7] text-foreground">
              {previewText}
            </div>
          </div>
          <Button variant="secondary" fullWidth onClick={handleCopy}>
            Copy
          </Button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(previewText ?? "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-2xl bg-success px-4 py-[18px] font-sans text-base font-extrabold text-white"
          >
            <MessageCircle className="size-5" /> Send on WhatsApp →
          </a>
        </div>
      </BottomSheet>
    </div>
  );
}
