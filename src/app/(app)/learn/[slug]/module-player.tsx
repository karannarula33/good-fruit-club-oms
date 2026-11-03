"use client";

// One Learn GFC module, step by step: the lesson screens, then the quick
// check, then "I've read and understood this". Every step is recorded on the
// server (src/app/actions/training.ts); this screen only shows it.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { FormError } from "@/components/ui/form-error";
import { LessonBlocks, InlineText } from "@/components/training/lesson-markdown";
import {
  acknowledgeModule,
  getQuiz,
  recordTrainingEvent,
  submitQuiz,
  type QuizFeedback,
  type QuizQuestion,
} from "@/app/actions/training";
import type { Screen } from "@/lib/training/markdown";
import type { ModuleParts, ModuleStatus } from "@/lib/training/progress";
import { cn } from "@/lib/cn";

type Step = { kind: "screen"; index: number } | { kind: "quiz" } | { kind: "ack" };

export function ModulePlayer(props: {
  moduleId: string;
  number: number;
  total: number;
  title: string;
  screens: Screen[];
  status: ModuleStatus;
  parts: ModuleParts;
  viewedScreens: number[];
  triedScreens: number[];
  bestScore: number | null;
  questionCount: number;
  nextSlug: string | null;
  nextTitle: string | null;
}) {
  const router = useRouter();
  const steps: Step[] = useMemo(
    () => [
      ...props.screens.map((_, index) => ({ kind: "screen" as const, index })),
      ...(props.questionCount > 0 ? [{ kind: "quiz" as const }] : []),
      { kind: "ack" as const },
    ],
    [props.screens, props.questionCount],
  );

  // Pick up where they left off: the first unviewed screen, else the check.
  const [viewed, setViewed] = useState<Set<number>>(() => new Set(props.viewedScreens));
  const recorded = useRef<Set<number>>(new Set(props.viewedScreens));
  const [tried, setTried] = useState<Set<number>>(() => new Set(props.triedScreens));
  const [passed, setPassed] = useState(props.parts.quizDone);
  const [acknowledged, setAcknowledged] = useState(props.status === "completed");
  const [stepIndex, setStepIndex] = useState(() => {
    if (props.status === "completed") return 0;
    const firstUnviewed = props.screens.findIndex((_, i) => !props.viewedScreens.includes(i));
    if (firstUnviewed !== -1) return firstUnviewed;
    return props.parts.quizDone ? steps.length - 1 : props.screens.length;
  });
  const step = steps[stepIndex];
  const topRef = useRef<HTMLDivElement>(null);

  // Record each screen the first time it's shown (once per screen).
  useEffect(() => {
    if (step.kind !== "screen" || recorded.current.has(step.index)) return;
    recorded.current.add(step.index);
    recordTrainingEvent(props.moduleId, step.index, "viewed").catch(() => undefined);
  }, [step, props.moduleId]);

  function go(to: number) {
    const next = Math.max(0, Math.min(steps.length - 1, to));
    const s = steps[next];
    // Both the screen being left and the one being opened count as viewed.
    setViewed((v) => {
      const n = new Set(v);
      if (step.kind === "screen") n.add(step.index);
      if (s.kind === "screen") n.add(s.index);
      return n;
    });
    setStepIndex(next);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // The screen showing now counts as viewed.
  const seen = step.kind === "screen" && !viewed.has(step.index) ? new Set(viewed).add(step.index) : viewed;
  const allViewed = props.screens.every((_, i) => seen.has(i));

  return (
    <div ref={topRef} className="flex flex-col gap-4 px-[18px] pt-5 pb-8">
      <PageHeader
        title={props.title}
        subtitle={`Module ${props.number} of ${props.total}`}
        backHref="/learn"
        backLabel="Learn GFC"
      />

      {props.status === "needs_review" && (
        <p className="rounded-xl bg-warning-bg px-3 py-2.5 font-sans text-[13.5px] font-semibold text-warning-text">
          Updated — this module has changed since you finished it. Go through it again and re-acknowledge.
        </p>
      )}

      {/* Step dots */}
      <div className="flex flex-wrap gap-1.5" aria-label="Progress through this module">
        {steps.map((s, i) => {
          const done =
            s.kind === "screen" ? seen.has(s.index) : s.kind === "quiz" ? passed : acknowledged;
          return (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              aria-label={s.kind === "screen" ? props.screens[s.index].title : s.kind === "quiz" ? "Quick check" : "Acknowledge"}
              aria-current={i === stepIndex}
              className={cn(
                "h-2 rounded-full transition-all",
                i === stepIndex ? "w-6 bg-foreground" : done ? "w-2 bg-brand" : "w-2 bg-[#E2DFD6]",
              )}
            />
          );
        })}
      </div>

      {step.kind === "screen" && (
        <Card elevated className="space-y-3 p-4">
          <p className="font-sans text-[11px] font-bold uppercase tracking-wide text-tertiary">
            {step.index + 1} / {props.screens.length}
          </p>
          <h2 className="font-display text-xl font-bold text-foreground">{props.screens[step.index].title}</h2>
          <LessonBlocks
            blocks={props.screens[step.index].blocks}
            renderTryIt={(b, key) => (
              <TryItCard
                key={key}
                title={b.title}
                href={b.href}
                steps={b.steps}
                done={tried.has(step.index)}
                onDone={() => {
                  const i = step.index;
                  setTried((s) => new Set(s).add(i));
                  recordTrainingEvent(props.moduleId, i, "try_it_done").catch(() => undefined);
                }}
              />
            )}
          />
        </Card>
      )}

      {step.kind === "quiz" && (
        <QuickCheck
          moduleId={props.moduleId}
          bestScore={props.bestScore}
          alreadyPassed={passed}
          onPassed={() => {
            setPassed(true);
            router.refresh();
          }}
          onContinue={() => go(steps.length - 1)}
        />
      )}

      {step.kind === "ack" && (
        <Acknowledge
          moduleId={props.moduleId}
          allViewed={allViewed}
          passed={passed || props.questionCount === 0}
          acknowledged={acknowledged}
          onDone={() => {
            setAcknowledged(true);
            router.refresh();
          }}
          goToUnviewed={() => go(props.screens.findIndex((_, i) => !seen.has(i)))}
          goToQuiz={() => go(props.screens.length)}
          nextSlug={props.nextSlug}
          nextTitle={props.nextTitle}
        />
      )}

      {/* Back / next */}
      {!(step.kind === "ack") && (
        <div className="flex gap-2">
          <Button variant="outline" size="md" onClick={() => go(stepIndex - 1)} disabled={stepIndex === 0}>
            Back
          </Button>
          {step.kind === "screen" && (
            <Button variant="dark" size="md" fullWidth onClick={() => go(stepIndex + 1)}>
              {stepIndex + 1 < props.screens.length ? "Next" : props.questionCount > 0 ? "Quick check →" : "Finish →"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function TryItCard({
  title,
  href,
  steps,
  done,
  onDone,
}: {
  title: string;
  href: string | null;
  steps: import("@/lib/training/markdown").Inline[][];
  done: boolean;
  onDone: () => void;
}) {
  return (
    <div className="space-y-2.5 rounded-2xl border-2 border-dashed border-brand/50 bg-[#FFF8EF] p-3.5">
      <p className="font-sans text-[11px] font-extrabold uppercase tracking-wide text-brand">Try it</p>
      <p className="font-display text-base font-bold text-foreground">{title}</p>
      <ol className="list-decimal space-y-1 pl-5 text-[14px]">
        {steps.map((s, j) => (
          <li key={j}>
            <InlineText nodes={s} />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2 pt-1">
        {href && (
          <Link
            href={href}
            target="_blank"
            prefetch={false}
            className="inline-flex items-center gap-1.5 rounded-xl bg-foreground px-3.5 py-2 font-sans text-sm font-extrabold text-white"
          >
            Open the screen <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        )}
        <button
          type="button"
          onClick={onDone}
          disabled={done}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 font-sans text-sm font-extrabold",
            done ? "bg-success-bg text-success-text" : "border border-[#ECEAE3] bg-white text-foreground",
          )}
        >
          {done ? (
            <>
              <Check className="size-4" aria-hidden="true" /> Done
            </>
          ) : (
            "I've done this"
          )}
        </button>
      </div>
    </div>
  );
}

function shuffledOrder(questions: QuizQuestion[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const q of questions) {
    const idx = q.options.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    out[q.id] = idx;
  }
  return out;
}

function QuickCheck({
  moduleId,
  bestScore,
  alreadyPassed,
  onPassed,
  onContinue,
}: {
  moduleId: string;
  bestScore: number | null;
  alreadyPassed: boolean;
  onPassed: () => void;
  onContinue: () => void;
}) {
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  // Options are shown in a fresh random order on every try (answers are still
  // sent as each option's original position).
  const [order, setOrder] = useState<Record<string, number[]>>({});
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{ score: number; correct: number; total: number; passed: boolean; passMark: number; feedback: QuizFeedback[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    getQuiz(moduleId).then((r) => {
      if (!live) return;
      if (r.ok) {
        setQuestions(r.questions);
        setOrder(shuffledOrder(r.questions));
      } else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [moduleId]);

  if (error && !questions) return <FormError>{error}</FormError>;
  if (!questions) return <p className="font-sans text-sm text-muted">Loading the quick check…</p>;

  const fb = (id: string) => result?.feedback.find((f) => f.questionId === id);
  const allAnswered = questions.every((q) => Number.isInteger(answers[q.id]));

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await submitQuiz(moduleId, answers);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResult(r);
      if (r.passed) onPassed();
    });
  }

  function retry() {
    setResult(null);
    setAnswers({});
    if (questions) setOrder(shuffledOrder(questions));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="flex flex-col gap-3">
      <Card elevated className="p-4">
        <h2 className="font-display text-xl font-bold text-foreground">Quick check</h2>
        <p className="font-sans text-[13.5px] text-muted">
          {questions.length} questions · pass mark 80% · you can try again.
          {alreadyPassed && bestScore !== null && ` You've passed (best ${bestScore}%).`}
        </p>
      </Card>

      {questions.map((q, n) => {
        const f = fb(q.id);
        return (
          <Card key={q.id} className="space-y-2.5 p-4">
            {q.kind === "scenario" && q.scenario && (
              <div className="space-y-1">
                <p className="font-sans text-[11px] font-extrabold uppercase tracking-wide text-tertiary">A member writes</p>
                <div className="flex max-w-[90%] items-start gap-2 rounded-2xl rounded-tl-sm bg-[#E8F5E9] px-3 py-2 font-sans text-[14px] text-foreground">
                  <MessageCircle className="mt-0.5 size-4 shrink-0 text-success-text" aria-hidden="true" />
                  <span>{q.scenario}</span>
                </div>
              </div>
            )}
            <p className="font-sans text-[14.5px] font-bold text-foreground">
              {n + 1}. {q.prompt}
            </p>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label={q.prompt}>
              {(order[q.id] ?? q.options.map((_, i) => i)).map((i) => {
                const opt = q.options[i];
                const chosen = answers[q.id] === i;
                const isRight = f && (i === f.correctIndex || (chosen && f.correct));
                const isWrongPick = f && chosen && !f.correct;
                return (
                  <button
                    key={i}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    disabled={!!result}
                    onClick={() => setAnswers((a) => ({ ...a, [q.id]: i }))}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left font-sans text-[14px] transition-colors",
                      isRight
                        ? "border-success bg-success-bg text-success-text"
                        : isWrongPick
                          ? "border-danger bg-danger-bg text-danger-text"
                          : chosen
                            ? "border-foreground bg-[#F7F5EF] font-semibold"
                            : "border-[#ECEAE3] bg-white",
                    )}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            {f && (
              <p className={cn("font-sans text-[13.5px]", f.correct ? "text-success-text" : "text-danger-text")}>
                <strong>{f.correct ? "Right." : "Not quite."}</strong>{" "}
                {f.explanation ? <span className="text-foreground">{f.explanation}</span> : !f.correct && <span className="text-muted">Have another look at the lesson.</span>}
              </p>
            )}
          </Card>
        );
      })}

      {error && <FormError>{error}</FormError>}

      {!result ? (
        <Button variant="dark" fullWidth onClick={submit} disabled={!allAnswered} pending={pending} pendingText="Checking…">
          {allAnswered ? "Check my answers" : `Answer all ${questions.length} questions`}
        </Button>
      ) : result.passed ? (
        <Card className="space-y-2 p-4">
          <p className="font-display text-lg font-bold text-success-text">
            {result.score}% — passed ({result.correct} of {result.total})
          </p>
          <Button variant="dark" fullWidth onClick={onContinue}>
            Continue →
          </Button>
        </Card>
      ) : (
        <Card className="space-y-2 p-4">
          <p className="font-display text-lg font-bold text-danger-text">
            {result.score}% — {result.correct} of {result.total}. You need {result.passMark}%.
          </p>
          <p className="font-sans text-[13.5px] text-muted">
            The ones marked &ldquo;Not quite&rdquo; need another look. Go back to the lesson if you like, then try again — the answers come in a new order.
          </p>
          <Button variant="dark" fullWidth onClick={retry}>
            Try again
          </Button>
        </Card>
      )}
    </div>
  );
}

function Acknowledge({
  moduleId,
  allViewed,
  passed,
  acknowledged,
  onDone,
  goToUnviewed,
  goToQuiz,
  nextSlug,
  nextTitle,
}: {
  moduleId: string;
  allViewed: boolean;
  passed: boolean;
  acknowledged: boolean;
  onDone: () => void;
  goToUnviewed: () => void;
  goToQuiz: () => void;
  nextSlug: string | null;
  nextTitle: string | null;
}) {
  const [ticked, setTicked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (acknowledged) {
    return (
      <Card elevated className="space-y-3 p-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success-bg text-success-text">
          <Check className="size-6" aria-hidden="true" />
        </div>
        <p className="font-display text-xl font-bold text-foreground">Module complete</p>
        {nextSlug ? (
          <Button href={`/learn/${nextSlug}`} variant="dark" fullWidth prefetch={false}>
            Next: {nextTitle} →
          </Button>
        ) : (
          <Button href="/learn" variant="dark" fullWidth prefetch={false}>
            Back to Learn GFC
          </Button>
        )}
      </Card>
    );
  }

  const ready = allViewed && passed;

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await acknowledgeModule(moduleId);
      if (!r.ok) setError(r.error);
      else onDone();
    });
  }

  return (
    <Card elevated className="space-y-3 p-4">
      <h2 className="font-display text-xl font-bold text-foreground">Wrap up</h2>
      <ul className="space-y-1.5 font-sans text-[14px]">
        <li className={allViewed ? "text-success-text" : "text-muted"}>
          {allViewed ? "✓" : "○"} Every screen read{" "}
          {!allViewed && (
            <button type="button" onClick={goToUnviewed} className="font-bold text-brand">
              — go back
            </button>
          )}
        </li>
        <li className={passed ? "text-success-text" : "text-muted"}>
          {passed ? "✓" : "○"} Quick check passed{" "}
          {!passed && (
            <button type="button" onClick={goToQuiz} className="font-bold text-brand">
              — take it
            </button>
          )}
        </li>
      </ul>
      <label className={cn("flex items-start gap-2.5 rounded-xl border px-3 py-3 font-sans text-[14px]", ready ? "border-[#ECEAE3]" : "border-[#F0EEE8] text-tertiary")}>
        <input type="checkbox" className="mt-0.5 size-4" disabled={!ready} checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
        <span>I&apos;ve read and understood this module.</span>
      </label>
      {error && <FormError>{error}</FormError>}
      <Button variant="primary" fullWidth disabled={!ready || !ticked} onClick={submit} pending={pending} pendingText="Saving…">
        Mark module complete
      </Button>
    </Card>
  );
}
