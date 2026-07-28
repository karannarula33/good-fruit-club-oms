"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dispatchPackedOrders } from "@/app/actions/dispatch";

export function DispatchButton({
  selectedIds,
  onDispatched,
}: {
  selectedIds: string[];
  onDispatched: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleClick() {
    setMessage(null);
    startTransition(async () => {
      const result = await dispatchPackedOrders(selectedIds);
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
      <button
        type="button"
        onClick={handleClick}
        disabled={pending || selectedIds.length === 0}
        className="rounded-full bg-neutral-900 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Dispatching…" : `Dispatch selected${selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}`}
      </button>
      {message && <span className="text-xs text-neutral-600">{message}</span>}
    </span>
  );
}
