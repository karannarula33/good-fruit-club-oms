"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { markOutForDelivery } from "@/app/actions/delivery";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";

export function MarkOutForDeliveryButton({
  selectedIds,
  onMarked,
  onOptimisticMark,
}: {
  selectedIds: string[];
  onMarked: () => void;
  onOptimisticMark: (ids: string[]) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    const ids = selectedIds;
    startTransition(async () => {
      onOptimisticMark(ids);
      const result = await markOutForDelivery(ids);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onMarked();
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <Button
        variant="primary"
        size="lg"
        fullWidth
        onClick={handleClick}
        disabled={selectedIds.length === 0}
        pending={pending}
        pendingText="Marking…"
      >
        <Truck className="size-5" aria-hidden="true" />
        Mark selected out for delivery{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
      </Button>
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
