"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetTrainingModule } from "@/app/actions/training";

// Two taps (Reset -> Confirm) instead of a browser confirm dialog.
export function ResetModuleButton({ userId, moduleId }: { userId: string; moduleId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="font-sans text-[12px] font-bold text-muted hover:text-foreground">
        Reset
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2 font-sans text-[12px]">
      {error && <span className="text-danger-text">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await resetTrainingModule(userId, moduleId);
            if (!r.ok) setError(r.error);
            else {
              setConfirming(false);
              router.refresh();
            }
          })
        }
        className="font-bold text-danger-text"
      >
        {pending ? "Resetting…" : "Confirm reset"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="font-bold text-muted">
        Cancel
      </button>
    </span>
  );
}
