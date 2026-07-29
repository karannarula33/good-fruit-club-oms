"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markListSent } from "@/app/actions/procurement";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";

export function MarkSentButton({ deliveryDate }: { deliveryDate: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await markListSent(deliveryDate);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <Button size="sm" onClick={handleClick} pending={pending} pendingText="Marking…">
        Mark list sent to vendor
      </Button>
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
