"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markOutForDelivery } from "@/app/actions/delivery";

export function MarkOutForDeliveryButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await markOutForDelivery();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="w-full rounded-md bg-neutral-900 px-4 py-3 text-lg text-white disabled:opacity-50"
      >
        {pending ? "Marking…" : "Mark all out for delivery"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
