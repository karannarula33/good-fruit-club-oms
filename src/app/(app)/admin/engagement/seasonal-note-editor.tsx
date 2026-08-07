"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { updateSeasonalNote } from "@/app/actions/engagement";

// §14.5/§9: the draft agent's "seasonal_note" input, e.g. "Cherry season
// ending soon; festive gift boxes and Turkish cherries newly launched" --
// a small admin-set field (eng_settings singleton,
// 0015_engagement_draft_agent.sql). Saved text feeds the *next* recompute's
// drafts, not the ones already sitting in today's queue.
export function SeasonalNoteEditor({ initialNote }: { initialNote: string | null }) {
  const [note, setNote] = useState(initialNote ?? "");
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();

  function handleSave() {
    startTransition(async () => {
      const result = await updateSeasonalNote(note);
      showToast(result.ok ? "Seasonal note saved" : result.error);
    });
  }

  return (
    <Card className="gap-2">
      <p className="font-sans text-[11px] font-bold uppercase tracking-wide text-muted">
        Seasonal note (for drafted messages)
      </p>
      <textarea
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Cherry season ending soon; festive gift boxes and Turkish cherries newly launched"
        className="w-full rounded-2xl border-[1.5px] border-[#ECEAE3] bg-[#F1F1EE] p-3 font-sans text-[13.5px] font-medium leading-[1.55] text-foreground focus:outline-none"
      />
      <Button size="sm" variant="outline" disabled={isPending} onClick={handleSave} className="self-end">
        Save
      </Button>
    </Card>
  );
}
