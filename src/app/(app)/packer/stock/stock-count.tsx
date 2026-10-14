"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { recordStockCount } from "@/app/actions/inventory";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { useToast } from "@/components/ui/toast";

export interface StockCountRow {
  productId: string;
  name: string;
  unitLabel: string | null;
  qty: string; // existing leftover for this date, or "" if none
}

export function StockCount({ date, rows }: { date: string; rows: StockCountRow[] }) {
  const router = useRouter();
  const { showToast } = useToast();

  const [qtyById, setQtyById] = useState<Record<string, string>>(
    () => Object.fromEntries(rows.map((r) => [r.productId, r.qty])),
  );
  const [filter, setFilter] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  }, [rows, filter]);

  const countedTotal = rows.filter((r) => {
    const n = Number(qtyById[r.productId]);
    return Number.isFinite(n) && n > 0;
  }).length;

  function handleSave() {
    setError(null);
    const items = rows.map((r) => ({ productId: r.productId, qty: Number(qtyById[r.productId]) || 0 }));
    startTransition(async () => {
      const result = await recordStockCount(date, items);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      showToast("Stock count saved ✓");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input
          type="text"
          inputMode="search"
          placeholder="Search products…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full pl-9"
        />
      </div>

      <p className="font-sans text-xs font-semibold text-muted">
        {countedTotal} product{countedTotal === 1 ? "" : "s"} with leftover · leave blank for none
      </p>

      <Card elevated className="!space-y-0 !p-1">
        {filtered.map((row) => (
          <div key={row.productId} className="flex items-center gap-3 rounded-2xl p-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate font-sans text-[14.5px] font-bold text-foreground">{row.name}</div>
              {row.unitLabel && (
                <div className="font-sans text-xs font-semibold text-muted">in {row.unitLabel}</div>
              )}
            </div>
            <Input
              type="number"
              inputMode="decimal"
              step="0.001"
              min="0"
              placeholder="0"
              value={qtyById[row.productId] ?? ""}
              onChange={(e) => setQtyById((prev) => ({ ...prev, [row.productId]: e.target.value }))}
              className="w-24 text-right"
            />
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="p-4 text-center font-sans text-sm text-muted">No products match “{filter}”.</div>
        )}
      </Card>

      {error && <FormError>{error}</FormError>}

      <div className="sticky bottom-3">
        <Button variant="primary" fullWidth onClick={handleSave} pending={pending} pendingText="Saving…">
          Save stock count
        </Button>
      </div>
    </div>
  );
}
