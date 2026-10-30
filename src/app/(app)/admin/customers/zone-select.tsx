"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCustomerZone } from "@/app/actions/customers";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/ui/form-error";
import { ZONE_ORDER, compareByZone, type Zone } from "@/lib/customers/zone";

// Options: the original zones, every zone already in use (new area-based ones
// like "Paschim Vihar"), and Unassigned.
export function ZoneSelect({ customerId, zone, zonesInUse }: { customerId: string; zone: Zone; zonesInUse: string[] }) {
  const ALL_ZONES = [...new Set([...ZONE_ORDER, ...zonesInUse, zone, "Unassigned"])].sort(compareByZone);
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
      <Select
        defaultValue={zone}
        onChange={handleChange}
        disabled={pending}
        className={zone === "Unassigned" ? "border-danger text-danger-text" : ""}
      >
        {ALL_ZONES.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </Select>
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
