import { and, eq, inArray } from "drizzle-orm";
import { attempt, attemptAnswer, classArm, enrollment, exam, examQuestion, student, subject } from "@/lib/db/schema";
import { round } from "@/lib/grading";
import type { TenantScope } from "@/lib/tenant/scope";
import { sees, type AnalyticsAccess } from "./access";
import { DONE } from "./stats";
import { mean, orderedTerms, subjectScores } from "./terms";

/** A topic/class cell needs this many answers before its % is shown. */
export const MIN_CELL = 5;

/**
 * Topic mastery for one subject in a term: % of marks earned on each topic's
 * questions, by class arm, across every exam that term. Plus the subject's
 * average by class over recent terms (from the CA grid).
 */
export async function topicMastery(scope: TenantScope, access: AnalyticsAccess, opts: { termId: string; subjectId?: string | null }) {
  const exams = (await scope.findMany(exam, eq(exam.termId, opts.termId))).filter((e) => e.publishedAt);
  const qs = exams.length ? (await scope.findMany(examQuestion, inArray(examQuestion.examId, exams.map((e) => e.id)))).filter((q) => sees(access, q.subjectId)) : [];
  const subjects = await scope.findMany(subject);
  const available = subjects.filter((s) => qs.some((q) => q.subjectId === s.id)).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const chosen = available.find((s) => s.id === opts.subjectId) ?? available[0] ?? null;
  if (!chosen) return { subjects: [], subject: null, arms: [], topics: [], weakest: [], exams: [], trend: null };

  const mine = qs.filter((q) => q.subjectId === chosen.id);
  const attempts = await scope.findMany(attempt, and(inArray(attempt.examId, [...new Set(mine.map((q) => q.examId))]), inArray(attempt.status, DONE))!);
  const [answers, students, arms, enrolled] = await Promise.all([
    attempts.length ? scope.findMany(attemptAnswer, and(inArray(attemptAnswer.attemptId, attempts.map((a) => a.id)), inArray(attemptAnswer.examQuestionId, mine.map((q) => q.id)))!) : [],
    scope.findMany(student),
    scope.findMany(classArm),
    scope.findMany(enrollment, eq(enrollment.termId, opts.termId)),
  ]);
  const armOfStudent = (id: string) => enrolled.find((e) => e.studentId === id)?.classArmId ?? students.find((s) => s.id === id)?.classArmId ?? null;
  const armName = new Map(arms.map((a) => [a.id, a.name]));
  const answerOf = new Map(answers.map((a) => [`${a.attemptId}:${a.examQuestionId}`, a]));

  type Cell = [number, number];
  const grid = new Map<string, { questions: Set<string>; total: Cell; arms: Map<string, Cell> }>();
  const armsSeen = new Set<string>();
  for (const at of attempts) {
    const arm = armName.get(armOfStudent(at.studentId) ?? "") ?? "—";
    for (const q of mine.filter((x) => x.examId === at.examId)) {
      const a = answerOf.get(`${at.id}:${q.id}`);
      if (q.snapshot.type === "theory" && (!a || a.marksAwarded === null)) continue;
      const credit = a ? Math.min(1, (a.marksAwarded ?? 0) / q.marks) : 0;
      const name = q.snapshot.topicName || "No topic";
      const t = grid.get(name) ?? { questions: new Set(), total: [0, 0], arms: new Map() };
      t.questions.add(q.questionId ?? q.id);
      t.total = [t.total[0] + credit, t.total[1] + 1];
      const c = t.arms.get(arm) ?? [0, 0];
      t.arms.set(arm, [c[0] + credit, c[1] + 1]);
      grid.set(name, t);
      armsSeen.add(arm);
    }
  }
  const pct = ([got, n]: Cell) => (n >= MIN_CELL ? round((got / n) * 100, 1) : null);
  const armList = [...armsSeen].sort();
  const topics = [...grid]
    .map(([name, t]) => ({
      name,
      questions: t.questions.size,
      answers: t.total[1],
      pct: pct(t.total),
      cells: armList.map((a) => {
        const c = t.arms.get(a) ?? [0, 0];
        return { arm: a, pct: pct(c), answers: c[1] };
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const weakest = [...topics]
    .filter((t) => t.pct !== null)
    .sort((a, b) => a.pct! - b.pct!)
    .slice(0, 5)
    .map((t) => {
      const worst = [...t.cells].filter((c) => c.pct !== null).sort((a, b) => a.pct! - b.pct!)[0];
      return { name: t.name, pct: t.pct!, questions: t.questions, worstArm: worst?.arm ?? null, worstPct: worst?.pct ?? null };
    });

  // Trend: this subject's CA-grid average by class over the last four terms with scores.
  const terms = await orderedTerms(scope);
  const upTo = terms.slice(0, terms.findIndex((t) => t.id === opts.termId) + 1).slice(-4);
  const scores = (await subjectScores(scope, upTo.map((t) => t.id))).filter((s) => s.subjectId === chosen.id);
  const trendTerms = upTo.filter((t) => scores.some((s) => s.termId === t.id));
  const trendArms = [...new Set(scores.map((s) => s.arm))].sort();
  const trend = trendTerms.length
    ? {
        terms: trendTerms.map((t) => ({ id: t.id, short: t.short, label: t.label })),
        rows: trendArms.map((arm) => ({ arm, values: trendTerms.map((t) => mean(scores.filter((s) => s.arm === arm && s.termId === t.id).map((s) => s.pct))) })),
      }
    : null;

  return {
    subjects: available.map((s) => ({ id: s.id, name: s.name })),
    subject: { id: chosen.id, name: chosen.name },
    arms: armList,
    topics,
    weakest,
    exams: exams.filter((e) => mine.some((q) => q.examId === e.id) && attempts.some((a) => a.examId === e.id)).map((e) => ({ id: e.id, title: e.title })),
    trend,
  };
}
