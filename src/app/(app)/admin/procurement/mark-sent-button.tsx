"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markListSent } from "@/app/actions/procurement";

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
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "Marking..." : "Mark list sent to vendor"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
