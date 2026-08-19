"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X } from "lucide-react";
import { publishPriceVersion } from "@/app/actions/prices";
import { utcToIstDatetimeLocal } from "@/lib/time/ist";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

// Shared by the Prices page and the Catalog screen: a single-item call to
// publishPriceVersion is a "direct edit" that still goes through the normal
// versioned-publish path (CLAUDE.md §3.2 -- price changes are a new version
// effective now, old prices stay immutable history), just without forcing
// the admin to re-paste the whole vendor list for a one-fruit change.
export function PriceQuickEdit({ productId, currentPrice }: { productId: string; currentPrice: number | null }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentPrice !== null ? String(currentPrice) : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const price = Number(value);
    if (!Number.isFinite(price) || price <= 0) {
      setError("Enter a price greater than zero.");
      return;
    }
    setError(null);
    setPending(true);
    const result = await publishPriceVersion({
      effectiveFromIst: utcToIstDatetimeLocal(new Date()),
      note: null,
      items: [{ productId, pricePerUnit: price }],
      newAliases: [],
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(false);
    showToast("Price updated ✓");
    router.refresh();
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(currentPrice !== null ? String(currentPrice) : "");
          setError(null);
          setEditing(true);
        }}
        className="flex shrink-0 items-center gap-1.5 font-display text-[15px] font-bold text-foreground"
      >
        {currentPrice !== null ? (
          `₹${currentPrice.toFixed(2)}`
        ) : (
          <span className="text-danger-text">Not priced</span>
        )}
        <Pencil className="size-3.5 text-muted" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <span className="font-sans text-sm font-bold text-muted">₹</span>
        <Input
          autoFocus
          className="w-[76px] text-center"
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={pending}
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="rounded-full p-1.5 text-success-text hover:bg-success-bg disabled:opacity-50"
        >
          <Check className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={pending}
          className="rounded-full p-1.5 text-muted hover:bg-neutral-bg disabled:opacity-50"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {error && <span className="font-sans text-[11px] font-semibold text-danger-text">{error}</span>}
    </div>
  );
}
