"use client";

// City / area / society for one customer (migration 0039). Shows what was read
// from the address; the admin can correct it (kept as manual) or ask for a
// fresh read.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rereadCustomerArea, setCustomerArea } from "@/app/actions/customer-area";
import { CITIES } from "@/lib/customers/area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/ui/form-error";

export function AreaEditor({
  customerId, city, area, locality, source, areaOptions,
}: {
  customerId: string;
  city: string | null;
  area: string | null;
  locality: string | null;
  source: "auto" | "manual" | null;
  areaOptions: string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ city: city ?? "Gurgaon", area: area ?? "", locality: locality ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const label = area ? [locality, area, city].filter(Boolean).join(", ") : city ? `${city} (area not found)` : "Not read yet";

  function save() {
    setError(null);
    start(async () => {
      const r = await setCustomerArea(customerId, form);
      if (!r.ok) { setError(r.error); return; }
      setEditing(false);
      router.refresh();
    });
  }

  function reread() {
    setError(null);
    start(async () => {
      const r = await rereadCustomerArea(customerId);
      if (!r.ok) { setError(r.error); return; }
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 font-sans text-xs">
        <span className="font-semibold text-muted">Area</span>
        <span className={area ? "font-semibold text-foreground" : "text-danger-text"}>{label}</span>
        {source === "manual" && <span className="text-tertiary">(set by hand)</span>}
        <button type="button" className="font-semibold text-brand" onClick={() => setEditing(true)} disabled={pending}>Edit</button>
        {source === "manual" && (
          <button type="button" className="font-semibold text-brand" onClick={reread} disabled={pending}>Re-read from address</button>
        )}
        {error && <FormError>{error}</FormError>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 font-sans text-xs">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} aria-label="City">
          {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Input list="area-options" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} placeholder="Area, e.g. DLF Phase 2" aria-label="Area" />
        <Input value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} placeholder="Society / building (optional)" aria-label="Society or building" />
        <datalist id="area-options">{areaOptions.map((a) => <option key={a} value={a} />)}</datalist>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={pending}>Save</Button>
        <Button size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={pending}>Cancel</Button>
      </div>
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
