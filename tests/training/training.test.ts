import { describe, expect, it } from "vitest";
import { gradeQuiz, moduleStatus, moduleParts } from "@/lib/training/progress";
import { parseBlocks, parseInline, splitScreens, safeHref } from "@/lib/training/markdown";
import { TRAINING_MODULES } from "@/lib/training/content";

const mod = { version: 2, screenCount: 3, questionCount: 4 };
const none = { viewedScreens: [], passedCurrentVersion: false, acknowledgedVersion: null, everCompletedVersion: null, anyActivity: false };

describe("moduleStatus", () => {
  it("not started until anything happens", () => {
    expect(moduleStatus(mod, none)).toBe("not_started");
  });
  it("needs every screen, a pass and the acknowledgement for the current version", () => {
    const some = { ...none, anyActivity: true, viewedScreens: [0, 1, 2], passedCurrentVersion: true };
    expect(moduleStatus(mod, some)).toBe("in_progress");
    expect(moduleStatus(mod, { ...some, acknowledgedVersion: 1 })).toBe("in_progress");
    expect(moduleStatus(mod, { ...some, acknowledgedVersion: 2 })).toBe("completed");
    expect(moduleStatus(mod, { ...some, viewedScreens: [0, 2], acknowledgedVersion: 2 })).toBe("in_progress");
  });
  it("a module completed for an older version needs review", () => {
    const old = { ...none, anyActivity: true, everCompletedVersion: 1, acknowledgedVersion: 1, viewedScreens: [] };
    expect(moduleStatus(mod, old)).toBe("needs_review");
  });
  it("a module with no questions doesn't need a quiz", () => {
    const p = moduleParts({ ...mod, questionCount: 0 }, { ...none, viewedScreens: [0, 1, 2], acknowledgedVersion: 2 });
    expect(p).toEqual({ screensDone: true, quizDone: true, acknowledged: true });
  });
  it("ignores out-of-range screen indexes", () => {
    expect(moduleParts(mod, { ...none, viewedScreens: [0, 1, 7] }).screensDone).toBe(false);
  });
});

describe("gradeQuiz", () => {
  const qs = [1, 2, 3, 4, 5].map((n) => ({ id: `q${n}`, correctIndex: 1 }));
  it("passes at 80%", () => {
    const g = gradeQuiz(qs, { q1: 1, q2: 1, q3: 1, q4: 1, q5: 0 });
    expect(g).toMatchObject({ correct: 4, total: 5, score: 80, passed: true });
  });
  it("fails below 80% and counts unanswered as wrong", () => {
    const g = gradeQuiz(qs, { q1: 1, q2: 1, q3: 1 });
    expect(g).toMatchObject({ correct: 3, score: 60, passed: false });
    expect(g.detail[4]).toEqual({ questionId: "q5", chosen: null, correct: false });
  });
});

describe("markdown", () => {
  it("splits screens on --- and uses the first heading as the title", () => {
    const s = splitScreens("## One\n\nHello\n\n---\n\n## Two\n\n- a\n- b");
    expect(s.map((x) => x.title)).toEqual(["One", "Two"]);
    expect(s[1].blocks[0]).toMatchObject({ t: "list", ordered: false });
  });
  it("parses tables, flags and try-it blocks", () => {
    const b = parseBlocks("| A | B |\n| --- | --- |\n| 1 | **2** |\n\n> ⚠️ Check with Karan: x\n\n```tryit\ntitle: Go\nhref: /delivery\n- Open it\n```");
    expect(b[0]).toMatchObject({ t: "table" });
    expect(b[1]).toMatchObject({ t: "quote", flag: true });
    expect(b[2]).toMatchObject({ t: "tryit", title: "Go", href: "/delivery" });
  });
  it("only keeps safe links", () => {
    expect(safeHref("/admin/orders")).toBe("/admin/orders");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("//evil.com")).toBeNull();
    expect(parseInline("[x](javascript:1)")).toEqual([{ t: "text", v: "x" }]);
  });
});

describe("starter content", () => {
  it("has the 11 handbook modules in order, each 3–6 screens with a valid quick check", () => {
    expect(TRAINING_MODULES).toHaveLength(11);
    expect(new Set(TRAINING_MODULES.map((m) => m.slug)).size).toBe(11);
    for (const m of TRAINING_MODULES) {
      const n = splitScreens(m.content).length;
      expect(n, m.slug).toBeGreaterThanOrEqual(3);
      expect(n, m.slug).toBeLessThanOrEqual(6);
      expect(m.questions.length, m.slug).toBeGreaterThanOrEqual(3);
      for (const q of m.questions) {
        expect(q.correct, q.prompt).toBeGreaterThanOrEqual(0);
        expect(q.correct, q.prompt).toBeLessThan(q.options.length);
        expect(q.explanation.length, q.prompt).toBeGreaterThan(10);
      }
    }
  });
  it("modules 8 and 10 include scenario practice", () => {
    for (const slug of ["gifting", "talking-to-members"]) {
      expect(TRAINING_MODULES.find((m) => m.slug === slug)!.questions.some((q) => q.kind === "scenario")).toBe(true);
    }
  });
});

describe("markdown never hangs", () => {
  it("treats a stray fence as text", () => {
    expect(parseBlocks("Intro\n```\ncode\n```").length).toBeGreaterThan(0);
    expect(parseBlocks("```t")).toEqual([{ t: "paragraph", v: [{ t: "text", v: "```t" }] }]);
    expect(safeHref("/\\evil.com")).toBeNull();
  });
});
