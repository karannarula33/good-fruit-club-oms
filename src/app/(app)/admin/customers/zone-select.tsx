"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCustomerZone } from "@/app/actions/customers";
import { ZONE_ORDER, type Zone } from "@/lib/customers/zone";

const ALL_ZONES: Zone[] = [...ZONE_ORDER, "Unassigned"];

export function ZoneSelect({ customerId, zone }: { customerId: string; zone: Zone }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const nextZone = e.target.value;
    setError(null);
    startTransition(async () => {
      const result = await updateCustomerZone(customerId, nextZone);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <select
        defaultValue={zone}
        onChange={handleChange}
        disabled={pending}
        className={`rounded-md border px-2 py-1 text-sm ${
          zone === "Unassigned" ? "border-red-400 text-red-700" : "border-neutral-300"
        }`}
      >
        {ALL_ZONES.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
