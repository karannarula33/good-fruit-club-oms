"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { dispatchPackedOrders } from "@/app/actions/dispatch";
import { Button } from "@/components/ui/button";

export function DispatchButton({
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
  const [message, setMessage] = useState<string | null>(null);

  function handleClick() {
    setMessage(null);
    const ids = selectedIds;
    startTransition(async () => {
      onOptimisticDispatch(ids);
      const result = await dispatchPackedOrders(ids);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setMessage(`Dispatched ${result.count} order${result.count === 1 ? "" : "s"}.`);
      onDispatched();
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="primary"
        size="sm"
        pill
        onClick={handleClick}
        disabled={selectedIds.length === 0}
        pending={pending}
        pendingText="Dispatching…"
      >
        <Truck className="size-4" aria-hidden="true" />
        Dispatch selected{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
      </Button>
      {message && <span className="text-xs text-neutral-600 dark:text-neutral-400">{message}</span>}
    </span>
  );
}
