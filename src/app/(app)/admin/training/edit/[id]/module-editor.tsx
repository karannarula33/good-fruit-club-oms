"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-error";
import { LessonBlocks } from "@/components/training/lesson-markdown";
import { splitScreens } from "@/lib/training/markdown";
import { updateTrainingModule } from "@/app/actions/training";
import { cn } from "@/lib/cn";

const HELP = `Screens are separated by a line with just ---. Each screen starts with "## Title".
**bold**, - bullets, 1. numbers, | tables |, [link](/admin/orders),
> ⚠️ Check with Karan: … shows as a flag. A try-it step:
\`\`\`tryit
title: Check today's deliveries
href: /delivery
- Open Route
\`\`\``;

export function ModuleEditor({
  moduleId,
  initial,
  questions,
}: {
  moduleId: string;
  initial: { title: string; summary: string; contentMd: string };
  questions: { id: string; kind: string; scenario: string | null; prompt: string; options: string[]; correctIndex: number; explanation: string }[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [summary, setSummary] = useState(initial.summary);
  const [content, setContent] = useState(initial.contentMd);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const screens = useMemo(() => splitScreens(content), [content]);
  const dirty = title !== initial.title || summary !== initial.summary || content !== initial.contentMd;

  function save() {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const r = await updateTrainingModule(moduleId, { title, summary, contentMd: content });
      if (!r.ok) setError(r.error);
      else {
        setSaved(`Saved as version ${r.version}.`);
        router.refresh();
      }
    });
  }

  const input = "w-full rounded-xl border border-[#ECEAE3] bg-white px-3 py-2 font-sans text-sm";

  return (
    <div className="flex flex-col gap-3">
      <Card elevated className="space-y-2.5 p-4">
        <label className="block font-sans text-[12px] font-bold text-muted">
          Title
          <input className={cn(input, "mt-1")} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block font-sans text-[12px] font-bold text-muted">
          One-line summary
          <input className={cn(input, "mt-1")} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
      </Card>

      <div className="flex gap-1 rounded-xl bg-neutral-bg p-1 font-sans text-sm font-bold">
        {(["edit", "preview"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cn("flex-1 rounded-lg py-1.5", tab === t ? "bg-white text-foreground shadow-sm" : "text-muted")}>
            {t === "edit" ? "Edit" : `Preview (${screens.length} screens)`}
          </button>
        ))}
      </div>

      {tab === "edit" ? (
        <Card elevated className="space-y-2 p-4">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={24}
            spellCheck
            className="w-full rounded-xl border border-[#ECEAE3] bg-[#FCFBF7] px-3 py-2.5 font-mono text-[12.5px] leading-relaxed"
            aria-label="Lesson content (Markdown)"
          />
          <pre className="whitespace-pre-wrap rounded-xl bg-neutral-bg px-3 py-2 font-mono text-[11px] text-muted">{HELP}</pre>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {screens.map((s, i) => (
            <Card key={i} elevated className="space-y-2 p-4">
              <p className="font-sans text-[11px] font-bold uppercase tracking-wide text-tertiary">
                {i + 1} / {screens.length}
              </p>
              <h2 className="font-display text-lg font-bold">{s.title}</h2>
              <LessonBlocks blocks={s.blocks} />
            </Card>
          ))}
        </div>
      )}

      {error && <FormError>{error}</FormError>}
      {saved && <p className="font-sans text-sm font-semibold text-success-text">{saved}</p>}
      <Button variant="primary" fullWidth onClick={save} disabled={!dirty} pending={pending} pendingText="Saving…">
        Save changes
      </Button>

      <Card elevated className="space-y-2 p-4">
        <p className="font-sans text-[13px] font-bold text-muted">Quick check ({questions.length} questions)</p>
        <p className="font-sans text-[12px] text-tertiary">If you change the lesson so an answer below is no longer right, ask Claude to update the questions.</p>
        {questions.map((q, n) => (
          <div key={q.id} className="space-y-1 border-t border-[#F3F1EA] pt-2 font-sans text-[13px]">
            {q.scenario && <p className="italic text-muted">Member: “{q.scenario}”</p>}
            <p className="font-semibold">
              {n + 1}. {q.prompt}
            </p>
            <ul className="space-y-0.5 pl-1">
              {q.options.map((o, i) => (
                <li key={i} className={i === q.correctIndex ? "font-semibold text-success-text" : "text-muted"}>
                  {i === q.correctIndex ? "✓ " : "· "}
                  {o}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Card>
    </div>
  );
}
