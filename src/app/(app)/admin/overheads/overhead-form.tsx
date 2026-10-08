"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addOverhead, deleteOverhead } from "@/app/actions/overheads";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/ui/form-error";
import type { OverheadCategory } from "@/lib/supabase/database.types";

export function OverheadForm({ today }: { today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [category, setCategory] = useState<OverheadCategory>("ads");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await addOverhead({ date, category, amount: Number(amount), note });
          if (!result.ok) { setError(result.error); return; }
          setAmount(""); setNote("");
          router.refresh();
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 font-sans text-xs font-semibold text-muted">
          Date
          <Input id="overhead-date" type="date" size="sm" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 font-sans text-xs font-semibold text-muted">
          Type
          <Select id="overhead-type" size="sm" value={category} onChange={(e) => setCategory(e.target.value as OverheadCategory)}>
            <option value="ads">Ads</option>
            <option value="day_level">Day-level cost (COD fee, Mover minimum)</option>
            <option value="other">Other</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 font-sans text-xs font-semibold text-muted">
          Amount (₹)
          <Input id="overhead-amount" type="number" inputMode="decimal" min="0" step="0.01" size="sm" className="w-28" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
        <label className="flex flex-1 min-w-40 flex-col gap-1 font-sans text-xs font-semibold text-muted">
          Note
          <Input id="overhead-note" size="sm" value={note} placeholder="e.g. Newspaper ad, half page" onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" disabled={pending} className="rounded-md bg-brand px-3 py-1.5 font-sans text-sm font-bold text-brand-foreground disabled:opacity-60">
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      {error && <FormError>{error}</FormError>}
    </form>
  );
}

// Two-step delete built into the row (the app can't use browser confirm dialogs).
export function DeleteOverheadButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return <button type="button" onClick={() => setArmed(true)} className="font-sans text-xs font-semibold text-muted hover:text-danger-text">Delete</button>;
  }
  return (
    <span className="inline-flex gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => { const r = await deleteOverhead(id); if (r.ok) router.refresh(); else setArmed(false); })}
        className="font-sans text-xs font-bold text-danger-text"
      >
        {pending ? "Deleting…" : "Confirm delete"}
      </button>
      <button type="button" onClick={() => setArmed(false)} className="font-sans text-xs text-muted">Cancel</button>
    </span>
  );
}
