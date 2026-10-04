/**
 * Simulated exam sittings for seeded data: each student has an ability, each
 * question a difficulty and a tempting wrong option; answers are marked by the
 * same server-side marking the runtime uses.
 */
import { eq } from "drizzle-orm";
import * as t from "@/lib/db/schema";
import { markResponse } from "@/lib/exams/rules";
import type { TenantScope } from "@/lib/tenant/scope";

const MIN = 60_000;
const DIFF = { easy: 0.28, medium: 0.48, hard: 0.62 } as const;

export function prng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

export type Sitting = {
  examId: string;
  /** Per bank question id: its difficulty and the wrong option index most students pick. */
  meta: Map<string, { difficulty: keyof typeof DIFF; trap: number }>;
  ability: (studentId: string) => number;
  startAt: Date;
  durationMinutes: number;
  seed: number;
  /** Students still writing (live exam): started, no submission. */
  inProgress?: Set<string>;
  /** Theory answers to write (by bank question id). */
  theoryText?: Map<string, string[]>;
  /** Skip these students (absent). */
  absent?: (index: number) => boolean;
};

export async function simulate(scope: TenantScope, s: Sitting) {
  const rand = prng(s.seed);
  const eqs = (await scope.findMany(t.examQuestion, eq(t.examQuestion.examId, s.examId))).sort((a, b) => a.sortOrder - b.sortOrder);
  const candidates = await scope.findMany(t.examCandidate, eq(t.examCandidate.examId, s.examId));
  const attempts: (typeof t.attempt.$inferInsert)[] = [];
  const answers: { studentId: string; rows: Omit<typeof t.attemptAnswer.$inferInsert, "attemptId" | "schoolId">[] }[] = [];
  const events: { studentId: string; type: "tab_hidden" | "fullscreen_exit" | "copy"; at: Date; meta: Record<string, unknown> }[] = [];
  for (const [n, c] of candidates.entries()) {
    if (s.absent?.(n)) continue;
    const ability = s.ability(c.studentId);
    const writing = s.inProgress?.has(c.studentId) ?? false;
    const started = new Date(s.startAt.getTime() + Math.floor(rand() * 6) * MIN);
    const deadline = new Date(started.getTime() + s.durationMinutes * MIN);
    let clock = started.getTime();
    const rows: (typeof answers)[number]["rows"] = [];
    let score = 0;
    const upTo = writing ? Math.floor(eqs.length * (0.3 + rand() * 0.5)) : eqs.length;
    for (const q of eqs.slice(0, upTo)) {
      const m = s.meta.get(q.questionId ?? "") ?? { difficulty: "medium", trap: 0 };
      clock += Math.round((25 + rand() * 40 + DIFF[m.difficulty] * 90) * 1000);
      if (q.snapshot.type === "theory") {
        const texts = s.theoryText?.get(q.questionId ?? "");
        if (!texts?.length || rand() < 0.15) continue;
        const response: t.AttemptResponse = { kind: "text", text: texts[Math.floor(rand() * texts.length)] };
        rows.push({ examQuestionId: q.id, response, flagged: false, clientSeq: rows.length + 1, answeredAt: new Date(clock), isCorrect: null, marksAwarded: null });
        continue;
      }
      if (rand() < 0.03) continue;
      const pRight = 1 / (1 + Math.exp(-(ability - DIFF[m.difficulty]) * 7));
      const options = q.snapshot.options;
      const right = options.findIndex((o) => o.isCorrect);
      let pick = right;
      if (rand() >= pRight) {
        const wrong = options.map((_, k) => k).filter((k) => k !== right);
        pick = rand() < 0.62 && m.trap !== right && options[m.trap] ? m.trap : wrong[Math.floor(rand() * wrong.length)];
      }
      const response: t.AttemptResponse = { kind: "choice", optionIds: [options[pick].id] };
      const mk = markResponse(q.snapshot, q.marks, response);
      score += mk.marksAwarded ?? 0;
      rows.push({ examQuestionId: q.id, response, flagged: rand() < 0.04, clientSeq: rows.length + 1, answeredAt: new Date(clock), isCorrect: mk.isCorrect, marksAwarded: mk.marksAwarded });
    }
    const timedOut = !writing && n % 13 === 5;
    const leaves = n % 11 === 3 ? 2 : n % 17 === 9 ? 1 : 0;
    attempts.push({
      schoolId: scope.schoolId,
      examId: s.examId,
      studentId: c.studentId,
      startedAt: started,
      deadlineAt: deadline,
      submittedAt: writing ? null : timedOut ? deadline : new Date(Math.min(clock + 40_000, deadline.getTime() - 30_000)),
      status: writing ? "in_progress" : timedOut ? "auto_submitted" : "submitted",
      submitReason: writing ? null : timedOut ? "timeout" : "student",
      questionOrder: eqs.map((q) => q.id),
      answeredCount: rows.length,
      currentIndex: Math.max(0, rows.length - 1),
      clientSeq: rows.length,
      integrityFlags: leaves + (n % 23 === 4 ? 1 : 0),
      leaveCount: leaves,
      deviceSessionId: writing ? `seed-${c.studentId.slice(0, 8)}` : null,
      lastSeenAt: writing ? new Date(clock) : null,
      score: writing ? null : score,
      maxScore: eqs.reduce((a, q) => a + q.marks, 0),
    });
    answers.push({ studentId: c.studentId, rows });
    for (let k = 0; k < leaves; k++) events.push({ studentId: c.studentId, type: "tab_hidden", at: new Date(started.getTime() + (6 + k * 7) * MIN), meta: { awayMs: 3000 + k * 4500 } });
    if (n % 23 === 4) events.push({ studentId: c.studentId, type: "copy", at: new Date(started.getTime() + 12 * MIN), meta: {} });
  }
  if (!attempts.length) return;
  const saved = await scope.insert(t.attempt, attempts);
  const byStudent = new Map(saved.map((a) => [a.studentId, a.id]));
  const answerRows = answers.flatMap((a) => a.rows.map((r) => ({ ...r, attemptId: byStudent.get(a.studentId)! })));
  for (let i = 0; i < answerRows.length; i += 2000) await scope.insert(t.attemptAnswer, answerRows.slice(i, i + 2000));
  const seq = new Map<string, number>();
  const evRows = events.map((e) => {
    const n = (seq.get(e.studentId) ?? 0) + 1;
    seq.set(e.studentId, n);
    return { attemptId: byStudent.get(e.studentId)!, type: e.type, clientSeq: n, at: e.at, meta: e.meta };
  });
  if (evRows.length) await scope.insert(t.integrityEvent, evRows);
}
