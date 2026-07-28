"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markOutForDelivery } from "@/app/actions/delivery";

export function MarkOutForDeliveryButton({
  selectedIds,
  onMarked,
}: {
  selectedIds: string[];
  onMarked: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await markOutForDelivery(selectedIds);
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
      <button
        type="button"
        onClick={handleClick}
        disabled={pending || selectedIds.length === 0}
        className="w-full rounded-md bg-neutral-900 px-4 py-3 text-lg text-white disabled:opacity-50"
      >
        {pending
          ? "Marking…"
          : `Mark selected out for delivery${selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}`}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
