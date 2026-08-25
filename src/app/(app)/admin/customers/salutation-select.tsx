"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCustomerSalutation } from "@/app/actions/customers";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/ui/form-error";
import type { Salutation } from "@/lib/supabase/database.types";

export function SalutationSelect({ customerId, salutation }: { customerId: string; salutation: Salutation | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    setError(null);
    startTransition(async () => {
      const result = await updateCustomerSalutation(customerId, next);
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
        defaultValue={salutation ?? ""}
        onChange={handleChange}
        disabled={pending}
        className={!salutation ? "border-tertiary text-muted" : ""}
      >
        <option value="" disabled>
          Not set
        </option>
        <option value="Sir">Sir</option>
        <option value="Ma'am">Ma&apos;am</option>
      </Select>
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
