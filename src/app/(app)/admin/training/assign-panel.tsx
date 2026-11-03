"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-error";
import { assignTraining } from "@/app/actions/training";

export function AssignPanel({
  assigned,
  candidates,
}: {
  assigned: { id: string; name: string }[];
  candidates: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(userId: string, assign: boolean) {
    setError(null);
    startTransition(async () => {
      const r = await assignTraining(userId, assign);
      if (!r.ok) setError(r.error);
      else {
        setPick("");
        router.refresh();
      }
    });
  }

  return (
    <Card elevated className="space-y-3 p-4">
      <p className="font-sans text-[13px] font-bold text-muted">Assigned learners</p>
      {assigned.length === 0 && <p className="font-sans text-sm text-muted">Nobody yet.</p>}
      {assigned.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-2 font-sans text-[14px]">
          <span className="font-semibold">{a.name}</span>
          <button type="button" disabled={pending} onClick={() => run(a.id, false)} className="text-[13px] font-bold text-muted hover:text-danger-text">
            Unassign
          </button>
        </div>
      ))}
      {candidates.length > 0 && (
        <div className="flex gap-2 border-t border-[#F3F1EA] pt-3">
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-[#ECEAE3] bg-white px-3 py-2 font-sans text-sm"
            aria-label="Choose a team member to assign"
          >
            <option value="">Assign onboarding to…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button variant="dark" size="md" disabled={!pick} pending={pending} onClick={() => run(pick, true)}>
            Assign
          </Button>
        </div>
      )}
      {error && <FormError>{error}</FormError>}
    </Card>
  );
}
