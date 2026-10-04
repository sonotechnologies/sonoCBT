import { and, desc, eq, inArray } from "drizzle-orm";
import { attempt, attemptAnswer, classArm, exam, examCandidate, examQuestion, examSubject, integrityEvent, student, subject } from "@/lib/db/schema";
import { round } from "@/lib/grading";
import { docToText } from "@/lib/questions/rich";
import { plainText } from "@/lib/questions/labels";
import { renderDoc } from "@/lib/questions/render";
import type { TenantScope } from "@/lib/tenant/scope";
import { AnalyticsError, median, PASS_MARK, sees, type AnalyticsAccess } from "./access";
import { DONE } from "./stats";

const LETTERS = "ABCDEFGH";

/** Exams with handed-in scripts that this person may look at, newest first. */
export async function analysableExams(scope: TenantScope, access: AnalyticsAccess) {
  const rows = await scope.query((db, owns) =>
    db
      .selectDistinct({ id: exam.id, title: exam.title, windowStart: exam.windowStart })
      .from(exam)
      .innerJoin(attempt, owns(attempt, and(eq(attempt.examId, exam.id), inArray(attempt.status, DONE))))
      .where(owns(exam))
      .orderBy(desc(exam.windowStart)),
  );
  if (access.subjectIds === null) return rows;
  const subs = rows.length ? await scope.findMany(examSubject, inArray(examSubject.examId, rows.map((r) => r.id))) : [];
  return rows.filter((r) => subs.some((s) => s.examId === r.id && sees(access, s.subjectId)));
}

export type ExamReport = Awaited<ReturnType<typeof examReport>>;

/**
 * One exam: scores, the spread, how each class did, the most-missed questions
 * (with the wrong option most chosen), time per question, topics and
 * integrity. Teachers only see the questions in their subjects; scores are then
 * worked out over those questions.
 */
export async function examReport(scope: TenantScope, access: AnalyticsAccess, examId: string) {
  const e = await scope.findFirst(exam, eq(exam.id, examId));
  if (!e) throw new AnalyticsError("Exam not found.");
  const allowed = (await analysableExams(scope, access)).some((x) => x.id === examId);
  if (!allowed) throw new AnalyticsError("Exam not found.");

  const [allQs, attempts, candidates, subjects, arms] = await Promise.all([
    scope.findMany(examQuestion, eq(examQuestion.examId, examId)),
    scope.findMany(attempt, and(eq(attempt.examId, examId), inArray(attempt.status, DONE))!),
    scope.findMany(examCandidate, eq(examCandidate.examId, examId)),
    scope.findMany(subject),
    scope.findMany(classArm),
  ]);
  const qs = allQs.filter((q) => sees(access, q.subjectId)).sort((a, b) => a.sortOrder - b.sortOrder);
  const partial = qs.length < allQs.length;
  const qIds = new Set(qs.map((q) => q.id));
  const [answers, students, events] = await Promise.all([
    attempts.length ? scope.findMany(attemptAnswer, inArray(attemptAnswer.attemptId, attempts.map((a) => a.id))) : [],
    attempts.length ? scope.findMany(student, inArray(student.id, attempts.map((a) => a.studentId))) : [],
    attempts.length ? scope.findMany(integrityEvent, inArray(integrityEvent.attemptId, attempts.map((a) => a.id))) : [],
  ]);
  const mine = answers.filter((a) => qIds.has(a.examQuestionId));
  const maxMarks = qs.reduce((s, q) => s + q.marks, 0);
  const armOf = new Map(students.map((s) => [s.id, arms.find((a) => a.id === s.classArmId)?.name ?? "—"]));
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));

  // Each script's score over the questions shown (unmarked theory counts 0 until marked).
  const byAttempt = new Map<string, typeof mine>();
  for (const a of mine) byAttempt.set(a.attemptId, [...(byAttempt.get(a.attemptId) ?? []), a]);
  const pendingTheory = mine.filter((a) => a.marksAwarded === null && a.response !== null).length;
  const scripts = attempts.map((at) => {
    const got = (byAttempt.get(at.id) ?? []).reduce((s, a) => s + (a.marksAwarded ?? 0), 0);
    const st = students.find((s) => s.id === at.studentId);
    return {
      attemptId: at.id,
      studentId: at.studentId,
      name: st ? `${st.firstName} ${st.lastName}` : "",
      admissionNo: st?.admissionNo ?? "",
      arm: armOf.get(at.studentId) ?? "—",
      score: round(got, 2),
      pct: maxMarks ? round((got / maxMarks) * 100, 1) : 0,
      minutes: at.submittedAt ? round((at.submittedAt.getTime() - at.startedAt.getTime()) / 60_000, 1) : null,
      flags: at.integrityFlags,
      reason: at.submitReason,
    };
  });
  const pcts = scripts.map((s) => s.pct);
  const avg = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 1) : null);
  const passRate = (xs: number[]) => (xs.length ? Math.round((xs.filter((p) => p >= PASS_MARK).length / xs.length) * 100) : null);

  // Time to answer: the gap since the student's previous answer (or since they started).
  const secs = new Map<string, number[]>();
  const allByAttempt = new Map<string, typeof answers>();
  for (const a of answers) allByAttempt.set(a.attemptId, [...(allByAttempt.get(a.attemptId) ?? []), a]);
  for (const at of attempts) {
    let prev = at.startedAt.getTime();
    for (const a of [...(allByAttempt.get(at.id) ?? [])].sort((x, y) => x.answeredAt.getTime() - y.answeredAt.getTime())) {
      const gap = (a.answeredAt.getTime() - prev) / 1000;
      prev = a.answeredAt.getTime();
      if (qIds.has(a.examQuestionId) && gap >= 0 && gap < 3600) secs.set(a.examQuestionId, [...(secs.get(a.examQuestionId) ?? []), gap]);
    }
  }

  const sat = attempts.length;
  const questions = qs.map((q, i) => {
    const rows = mine.filter((a) => a.examQuestionId === q.id);
    const marked = rows.filter((a) => a.marksAwarded !== null);
    const credit = marked.reduce((s, a) => s + Math.min(1, (a.marksAwarded ?? 0) / q.marks), 0);
    // Out of everyone who sat it: a skipped question counts as missed.
    const objective = q.snapshot.type !== "theory";
    const pctCorrect = objective ? (sat ? round((credit / sat) * 100, 1) : 0) : marked.length ? round((credit / marked.length) * 100, 1) : 0;
    const counts = new Map<string, number>();
    for (const a of rows) if (a.response?.kind === "choice") for (const id of a.response.optionIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    const opts = q.snapshot.options.map((o, k) => ({ letter: LETTERS[k], text: plainText(docToText(o.content)), html: renderDoc(o.content), isCorrect: o.isCorrect, picked: sat ? round(((counts.get(o.id) ?? 0) / sat) * 100, 1) : 0 }));
    const wrong = opts.filter((o) => !o.isCorrect).sort((a, b) => b.picked - a.picked)[0];
    const skipped = sat ? round(((sat - rows.filter((a) => a.response !== null).length) / sat) * 100, 1) : 0;
    return {
      id: q.id,
      number: i + 1,
      code: q.snapshot.code,
      type: q.snapshot.type,
      marks: q.marks,
      topic: q.snapshot.topicName || "No topic",
      subject: subjectName.get(q.subjectId ?? "") ?? "",
      text: plainText(docToText(q.snapshot.stem)),
      html: renderDoc(q.snapshot.stem),
      pctCorrect,
      right: opts.filter((o) => o.isCorrect),
      wrong: wrong && wrong.picked > 0 ? wrong : null,
      options: opts,
      skipped,
      medianSeconds: median(secs.get(q.id) ?? []),
    };
  });

  // Topics, overall and by class.
  const armNames = [...new Set(scripts.map((s) => s.arm))].sort();
  const attemptArm = new Map(scripts.map((s) => [s.attemptId, s.arm]));
  const topicAgg = new Map<string, { qs: Set<string>; total: [number, number]; arms: Map<string, [number, number]> }>();
  for (const q of qs) {
    const tname = q.snapshot.topicName || "No topic";
    const t = topicAgg.get(tname) ?? { qs: new Set(), total: [0, 0], arms: new Map() };
    t.qs.add(q.id);
    topicAgg.set(tname, t);
  }
  const answerOf = new Map(mine.map((a) => [`${a.attemptId}:${a.examQuestionId}`, a]));
  for (const at of attempts) {
    for (const q of qs) {
      const a = answerOf.get(`${at.id}:${q.id}`);
      if (q.snapshot.type === "theory" && (!a || a.marksAwarded === null)) continue;
      const c = a ? Math.min(1, (a.marksAwarded ?? 0) / q.marks) : 0;
      const t = topicAgg.get(q.snapshot.topicName || "No topic")!;
      t.total = [t.total[0] + c, t.total[1] + 1];
      const arm = attemptArm.get(at.id)!;
      const cell = t.arms.get(arm) ?? [0, 0];
      t.arms.set(arm, [cell[0] + c, cell[1] + 1]);
    }
  }
  const pct = ([got, n]: [number, number]) => (n ? round((got / n) * 100, 1) : null);
  const topics = [...topicAgg]
    .map(([name, t]) => ({ name, questions: t.qs.size, pct: pct(t.total), arms: Object.fromEntries(armNames.map((a) => [a, pct(t.arms.get(a) ?? [0, 0])])) }))
    .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101));

  const typeCounts = new Map<string, number>();
  for (const ev of events) if (!["started", "resumed", "submitted"].includes(ev.type)) typeCounts.set(ev.type, (typeCounts.get(ev.type) ?? 0) + 1);

  return {
    exam: { id: e.id, title: e.title, windowStart: e.windowStart, durationMinutes: e.durationMinutes },
    partial,
    maxMarks,
    pendingTheory,
    stats: {
      candidates: candidates.length,
      sat,
      average: avg(pcts),
      median: median(pcts),
      passRate: passRate(pcts),
      highest: pcts.length ? Math.max(...pcts) : null,
      lowest: pcts.length ? Math.min(...pcts) : null,
      medianMinutes: median(scripts.map((s) => s.minutes).filter((m): m is number => m !== null)),
    },
    distribution: Array.from({ length: 10 }, (_, k) => ({ from: k * 10, count: pcts.filter((p) => Math.min(9, Math.floor(p / 10)) === k).length })),
    byArm: armNames.map((name) => {
      const xs = scripts.filter((s) => s.arm === name).map((s) => s.pct);
      return { name, sat: xs.length, average: avg(xs), passRate: passRate(xs) };
    }),
    questions,
    mostMissed: [...questions].sort((a, b) => a.pctCorrect - b.pctCorrect).slice(0, 5),
    topics,
    armNames,
    scripts: scripts.sort((a, b) => b.pct - a.pct),
    integrity: {
      flaggedScripts: scripts.filter((s) => s.flags > 0).length,
      autoSubmitted: { timeout: scripts.filter((s) => s.reason === "timeout").length, integrity: scripts.filter((s) => s.reason === "integrity").length },
      events: [...typeCounts].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    },
  };
}
