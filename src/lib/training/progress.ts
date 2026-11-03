// Learn GFC completion rules (brief: "GFC OMS Onboarding Panel"). A module is
// completed only when, for its CURRENT version:
//   1. every lesson screen has been viewed,
//   2. the quick check was passed (>= 80%; retries allowed), and
//   3. the learner ticked "I've read and understood this".
// A module completed for an older version (the admin edited it since) is
// "needs_review" until all three are done again for the new version.
// A module with no quick-check questions only needs 1 and 3.

export const PASS_MARK = 80;

export type ModuleStatus = "not_started" | "in_progress" | "completed" | "needs_review";

export interface ModuleFacts {
  version: number;
  screenCount: number;
  questionCount: number;
}

export interface LearnerFacts {
  viewedScreens: number[];          // screen indexes viewed for the current version
  passedCurrentVersion: boolean;    // a passing attempt exists for the current version
  acknowledgedVersion: number | null;
  everCompletedVersion: number | null; // highest version they ever completed (null = never)
  anyActivity: boolean;             // anything at all recorded for this module
}

export interface ModuleParts {
  screensDone: boolean;
  quizDone: boolean;
  acknowledged: boolean;
}

export function moduleParts(m: ModuleFacts, l: LearnerFacts): ModuleParts {
  const viewed = new Set(l.viewedScreens.filter((i) => i >= 0 && i < m.screenCount));
  return {
    screensDone: viewed.size >= m.screenCount,
    quizDone: m.questionCount === 0 || l.passedCurrentVersion,
    acknowledged: l.acknowledgedVersion === m.version,
  };
}

export function moduleStatus(m: ModuleFacts, l: LearnerFacts): ModuleStatus {
  const p = moduleParts(m, l);
  if (p.screensDone && p.quizDone && p.acknowledged) return "completed";
  if (l.everCompletedVersion !== null && l.everCompletedVersion < m.version) return "needs_review";
  return l.anyActivity ? "in_progress" : "not_started";
}

// Grade a quick check. `answers` maps questionId -> chosen option index.
export function gradeQuiz(
  questions: { id: string; correctIndex: number }[],
  answers: Record<string, number>,
): { correct: number; total: number; score: number; passed: boolean; detail: { questionId: string; chosen: number | null; correct: boolean }[] } {
  const detail = questions.map((q) => {
    const chosen = Number.isInteger(answers[q.id]) ? answers[q.id] : null;
    return { questionId: q.id, chosen, correct: chosen === q.correctIndex };
  });
  const correct = detail.filter((d) => d.correct).length;
  const total = questions.length;
  const score = total === 0 ? 100 : Math.round((correct / total) * 100);
  return { correct, total, score, passed: score >= PASS_MARK, detail };
}

export const STATUS_LABEL: Record<ModuleStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Done",
  needs_review: "Updated — review",
};
