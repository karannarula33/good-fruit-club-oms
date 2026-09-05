"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCustomerPaymentMode } from "@/app/actions/customers";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/ui/form-error";
import type { PaymentMode } from "@/lib/supabase/database.types";

export function PaymentModeSelect({ customerId, paymentMode }: { customerId: string; paymentMode: PaymentMode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    setError(null);
    startTransition(async () => {
      const result = await updateCustomerPaymentMode(customerId, next);
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
        defaultValue={paymentMode}
        onChange={handleChange}
        disabled={pending}
        className={paymentMode === "cod" ? "border-tertiary text-foreground" : ""}
      >
        <option value="online">Online</option>
        <option value="cod">COD</option>
      </Select>
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
