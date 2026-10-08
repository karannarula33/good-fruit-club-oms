"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

type View = "day" | "week" | "month" | "custom";

const VIEWS: { view: View; label: string }[] = [
  { view: "day", label: "Day" },
  { view: "week", label: "Week" },
  { view: "month", label: "Month" },
  { view: "custom", label: "Range" },
];

function shift(view: View, anchor: string, dir: -1 | 1): string {
  const d = new Date(`${anchor}T00:00:00Z`);
  if (view === "day") d.setUTCDate(d.getUTCDate() + dir);
  else if (view === "week") d.setUTCDate(d.getUTCDate() + 7 * dir);
  else d.setUTCMonth(d.getUTCMonth() + dir, 1);
  return d.toISOString().slice(0, 10);
}

const base = "/admin/dashboard";

// Day / week / month step with Prev and Next around an anchor date; "Range"
// takes any From and To. Everything lives in the URL so a view can be shared
// or bookmarked.
export function RangeControls({ view, anchor, from, to, today }: { view: View; anchor: string; from: string; to: string; today: string }) {
  const router = useRouter();
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex rounded-md border border-neutral-300 overflow-hidden text-sm font-sans font-semibold">
        {VIEWS.map((v) => (
          <Link
            key={v.view}
            href={v.view === "custom" ? `${base}?view=custom&from=${from}&to=${to}` : `${base}?view=${v.view}&date=${anchor}`}
            prefetch={false}
            className={cn("px-3 py-1", view === v.view ? "bg-brand text-brand-foreground" : "text-muted")}
          >
            {v.label}
          </Link>
        ))}
      </div>
      {view === "custom" ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (customFrom && customTo && customFrom <= customTo) router.push(`${base}?view=custom&from=${customFrom}&to=${customTo}`);
          }}
        >
          <label htmlFor="range-from" className="font-sans text-xs font-semibold text-muted">From</label>
          <Input id="range-from" type="date" size="sm" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} />
          <label htmlFor="range-to" className="font-sans text-xs font-semibold text-muted">To</label>
          <Input id="range-to" type="date" size="sm" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} />
          <button type="submit" className="rounded-md bg-brand px-3 py-1 font-sans text-sm font-bold text-brand-foreground">Show</button>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <Link href={`${base}?view=${view}&date=${shift(view, anchor, -1)}`} prefetch={false} className="font-sans text-sm font-bold text-muted">
            ← Prev
          </Link>
          <Input
            type="date"
            size="sm"
            value={anchor}
            aria-label="Date"
            onChange={(e) => {
              if (e.target.value) router.push(`${base}?view=${view}&date=${e.target.value}`);
            }}
          />
          <Link href={`${base}?view=${view}&date=${shift(view, anchor, 1)}`} prefetch={false} className="font-sans text-sm font-bold text-muted">
            Next →
          </Link>
          {anchor !== today && (
            <Link href={`${base}?view=${view}&date=${today}`} prefetch={false} className="font-sans text-sm font-bold text-brand">
              Today
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
