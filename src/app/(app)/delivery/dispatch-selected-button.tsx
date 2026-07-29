"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { dispatchPackedOrders } from "@/app/actions/dispatch";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";

export function DispatchSelectedButton({
  selectedIds,
  onDispatched,
  onOptimisticDispatch,
}: {
  selectedIds: string[];
  onDispatched: () => void;
  onOptimisticDispatch: (ids: string[]) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    const ids = selectedIds;
    startTransition(async () => {
      onOptimisticDispatch(ids);
      const result = await dispatchPackedOrders(ids);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDispatched();
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <Button
        variant="dark"
        fullWidth
        onClick={handleClick}
        disabled={selectedIds.length === 0}
        pending={pending}
        pendingText="Dispatching…"
      >
        <Truck className="size-5" aria-hidden="true" />
        Dispatch selected{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
      </Button>
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
