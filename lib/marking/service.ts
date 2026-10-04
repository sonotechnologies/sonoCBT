/**
 * Theory marking and moving exam scores into the CA grid. Objective questions
 * are marked by the server at submission; theory answers wait here for a
 * teacher (with an optional AI suggestion that is never applied by itself).
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { can, type Actor } from "@/lib/auth/permissions";
import { assessmentComponent, attempt, attemptAnswer, exam, examQuestion, student, subject, subjectOffering } from "@/lib/db/schema";
import { isAnswered } from "@/lib/exams/local";
import { docToText } from "@/lib/questions/rich";
import { renderDoc } from "@/lib/questions/render";
import { round } from "@/lib/grading";
import { refreshExamStats } from "@/lib/analytics/stats";
import { saveScores } from "@/lib/results/pipeline";
import { scaleScore } from "@/lib/results/rules";
import type { TenantScope } from "@/lib/tenant/scope";

export class MarkingError extends Error {}

/** Can this person mark (or moderate) answers for this subject in this class? */
async function markRights(scope: TenantScope, actor: Actor) {
  const [offerings, subjects] = await Promise.all([scope.findMany(subjectOffering), scope.findMany(subject)]);
  const dept = new Map(subjects.map((s) => [s.id, s.departmentId]));
  return (classArmId: string | null, subjectId: string | null) => {
    if (can(actor, "marks.moderate", { schoolId: scope.schoolId, departmentId: subjectId ? dept.get(subjectId) ?? null : null })) return true;
    const o = offerings.find((x) => x.classArmId === classArmId && x.subjectId === subjectId);
    return can(actor, "marks.enter", { schoolId: scope.schoolId, teacherId: o?.teacherId ?? null });
  };
}

type Row = {
  answerId: string;
  attemptId: string;
  examQuestionId: string;
  response: (typeof attemptAnswer.$inferSelect)["response"];
  marksAwarded: number | null;
  comment: string | null;
  aiMarks: number | null;
  aiPoints: (typeof attemptAnswer.$inferSelect)["aiPoints"];
  classArmId: string | null;
  studentName: string;
};

/** Answered theory questions in finished attempts, for one exam (or all). */
async function theoryRows(scope: TenantScope, examId?: string): Promise<(Row & { examId: string; subjectId: string | null; marks: number; snapshot: (typeof examQuestion.$inferSelect)["snapshot"]; sortOrder: number })[]> {
  return scope.query((db, owns) =>
    db
      .select({
        answerId: attemptAnswer.id,
        attemptId: attempt.id,
        examId: attempt.examId,
        examQuestionId: examQuestion.id,
        subjectId: examQuestion.subjectId,
        marks: examQuestion.marks,
        snapshot: examQuestion.snapshot,
        sortOrder: examQuestion.sortOrder,
        response: attemptAnswer.response,
        marksAwarded: attemptAnswer.marksAwarded,
        comment: attemptAnswer.comment,
        aiMarks: attemptAnswer.aiMarks,
        aiPoints: attemptAnswer.aiPoints,
        classArmId: student.classArmId,
        studentName: sql<string>`${student.firstName} || ' ' || ${student.lastName}`,
      })
      .from(attemptAnswer)
      .innerJoin(attempt, owns(attempt, and(eq(attempt.id, attemptAnswer.attemptId), ne(attempt.status, "in_progress"))))
      .innerJoin(examQuestion, owns(examQuestion, eq(examQuestion.id, attemptAnswer.examQuestionId)))
      .innerJoin(student, owns(student, eq(student.id, attempt.studentId)))
      .where(owns(attemptAnswer, and(sql`${examQuestion.snapshot}->>'type' = 'theory'`, examId ? eq(attempt.examId, examId) : undefined)))
      .orderBy(asc(attempt.id)),
  );
}

/** Theory questions waiting for marks that this person can mark, with progress. */
export async function markingQueue(scope: TenantScope, actor: Actor) {
  const [rows, allowed] = await Promise.all([theoryRows(scope), markRights(scope, actor)]);
  const mine = rows.filter((r) => isAnswered(r.response) && allowed(r.classArmId, r.subjectId));
  const examIds = [...new Set(mine.map((r) => r.examId))];
  const exams = examIds.length ? await scope.findMany(exam, inArray(exam.id, examIds)) : [];
  const groups = new Map<string, { examQuestionId: string; examId: string; examTitle: string; code: string; text: string; marks: number; total: number; marked: number; sortOrder: number }>();
  for (const r of mine) {
    const g = groups.get(r.examQuestionId) ?? {
      examQuestionId: r.examQuestionId,
      examId: r.examId,
      examTitle: exams.find((e) => e.id === r.examId)?.title ?? "",
      code: r.snapshot.code,
      text: docToText(r.snapshot.stem).slice(0, 140),
      marks: r.marks,
      total: 0,
      marked: 0,
      sortOrder: r.sortOrder,
    };
    g.total++;
    if (r.marksAwarded !== null) g.marked++;
    groups.set(r.examQuestionId, g);
  }
  return [...groups.values()].sort((a, b) => a.examTitle.localeCompare(b.examTitle) || a.sortOrder - b.sortOrder);
}

/** One question's scripts in a fixed, anonymous order ("Script 3 of 41"). */
export async function markingSession(scope: TenantScope, actor: Actor, examQuestionId: string, opts: { showNames?: boolean } = {}) {
  const q = await scope.findFirst(examQuestion, eq(examQuestion.id, examQuestionId));
  if (!q || q.snapshot.type !== "theory") throw new MarkingError("Question not found.");
  const [rows, allowed, e] = await Promise.all([theoryRows(scope, q.examId), markRights(scope, actor), scope.findFirst(exam, eq(exam.id, q.examId))]);
  const mine = rows.filter((r) => r.examQuestionId === examQuestionId && isAnswered(r.response) && allowed(r.classArmId, r.subjectId));
  if (!mine.length) throw new MarkingError("There's nothing for you to mark here.");
  const moderator = can(actor, "marks.moderate", { schoolId: scope.schoolId });
  // Stable anonymous order: by attempt, not name or seat.
  const qs = (await scope.findMany(examQuestion, eq(examQuestion.examId, q.examId))).filter((x) => x.snapshot.type === "theory").sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    exam: { id: q.examId, title: e?.title ?? "", aiMarking: !!e?.aiMarking },
    question: {
      id: q.id,
      code: q.snapshot.code,
      marks: q.marks,
      stemHtml: renderDoc(q.snapshot.stem),
      guideHtml: q.snapshot.answer.kind === "theory" && q.snapshot.answer.markingGuide ? renderDoc(q.snapshot.answer.markingGuide) : null,
      number: qs.findIndex((x) => x.id === q.id) + 1,
      of: qs.length,
      siblings: qs.map((x) => x.id),
    },
    scripts: mine.map((r, i) => ({
      answerId: r.answerId,
      n: i + 1,
      text: r.response?.kind === "text" ? r.response.text : "",
      marks: r.marksAwarded,
      comment: r.comment,
      aiMarks: r.aiMarks,
      aiPoints: r.aiPoints,
      name: opts.showNames && moderator ? r.studentName : null,
    })),
    canShowNames: moderator,
  };
}

async function answerFor(scope: TenantScope, actor: Actor, answerId: string) {
  const a = await scope.findFirst(attemptAnswer, eq(attemptAnswer.id, answerId));
  if (!a) throw new MarkingError("Answer not found.");
  const [q, at] = await Promise.all([scope.findFirst(examQuestion, eq(examQuestion.id, a.examQuestionId)), scope.findFirst(attempt, eq(attempt.id, a.attemptId))]);
  if (!q || !at || q.snapshot.type !== "theory") throw new MarkingError("Answer not found.");
  if (at.status === "in_progress") throw new MarkingError("The student is still writing.");
  const s = await scope.findFirst(student, eq(student.id, at.studentId));
  if (!(await markRights(scope, actor))(s?.classArmId ?? null, q.subjectId)) throw new MarkingError("You can't mark this answer.");
  return { a, q, at };
}

/** Saves a teacher's mark (and comment), then updates the attempt's score. Changing a mark is audited. */
export async function saveMark(scope: TenantScope, actor: Actor, answerId: string, marks: number, comment: string | null, now = new Date()) {
  const { a, q, at } = await answerFor(scope, actor, answerId);
  if (!(Number.isFinite(marks) && marks >= 0 && marks <= q.marks && Math.round(marks * 2) === marks * 2)) {
    throw new MarkingError(`Give a score from 0 to ${q.marks} (whole or half marks).`);
  }
  await scope.transaction(async (tx) => {
    await tx.update(
      attemptAnswer,
      { marksAwarded: marks, isCorrect: marks >= q.marks, markedBy: actor.id, markedAt: now, comment: comment?.trim().slice(0, 500) || null },
      eq(attemptAnswer.id, a.id),
    );
    const [{ total }] = await tx.query((db, owns) =>
      db
        .select({ total: sql<number>`coalesce(sum(${attemptAnswer.marksAwarded}), 0)::float` })
        .from(attemptAnswer)
        .where(owns(attemptAnswer, eq(attemptAnswer.attemptId, at.id))),
    );
    await tx.update(attempt, { score: round(total, 2) }, eq(attempt.id, at.id));
    if (a.marksAwarded !== null && a.marksAwarded !== marks) {
      await tx.query((db) =>
        audit(db, { schoolId: tx.schoolId, actorUserId: actor.id, action: "marks.change", entityType: "attempt_answer", entityId: a.id, meta: { examId: at.examId, question: q.snapshot.code, from: a.marksAwarded, to: marks } }),
      );
    }
  });
}

/** Stores an AI suggestion for one script. Only text goes to the AI; the teacher still decides. */
export async function suggestMark(
  scope: TenantScope,
  actor: Actor,
  answerId: string,
  ask: (r: { question: string; guide: string; maxMarks: number; answer: string }) => Promise<{ marks: number; points: { ok: boolean; text: string }[] }>,
) {
  const { a, q, at } = await answerFor(scope, actor, answerId);
  const e = await scope.findFirst(exam, eq(exam.id, at.examId));
  if (!e?.aiMarking) throw new MarkingError("AI suggestions are switched off for this exam.");
  const text = a.response?.kind === "text" ? a.response.text : "";
  if (!text.trim()) throw new MarkingError("There's no answer to look at.");
  const guide = q.snapshot.answer.kind === "theory" && q.snapshot.answer.markingGuide ? docToText(q.snapshot.answer.markingGuide) : "";
  const s = await ask({ question: docToText(q.snapshot.stem), guide, maxMarks: q.marks, answer: text });
  await scope.update(attemptAnswer, { aiMarks: s.marks, aiPoints: s.points }, eq(attemptAnswer.id, a.id));
  return s;
}

// ─── Exam → CA grid ──────────────────────────────────────────────────────────

/**
 * Sends an exam's scores to the CA grid: each student's marks per subject,
 * scaled to the component the exam counts towards (15 of 22 → 40.9 of 60).
 * Needs every theory answer marked and nobody still writing.
 */
export async function pushExamScores(scope: TenantScope, actor: Actor, examId: string, now = new Date()) {
  const e = await scope.findFirst(exam, eq(exam.id, examId));
  if (!e || e.status === "draft") throw new MarkingError("Exam not found.");
  if (!can(actor, "marks.moderate", { schoolId: scope.schoolId }) && !can(actor, "exam.manage", { schoolId: scope.schoolId })) throw new MarkingError("Only the exam officer can send scores to the grid.");
  if (!e.componentId) throw new MarkingError("Choose which part of the term's result this exam counts towards (exam Details).");
  const component = await scope.findFirst(assessmentComponent, eq(assessmentComponent.id, e.componentId));
  if (!component) throw new MarkingError("That result component no longer exists. Choose another.");
  const [attempts, questions] = await Promise.all([scope.findMany(attempt, eq(attempt.examId, examId)), scope.findMany(examQuestion, eq(examQuestion.examId, examId))]);
  if (attempts.some((a) => a.status === "in_progress")) throw new MarkingError("Some students are still writing. Send scores when everyone has finished.");
  const done = attempts.filter((a) => a.status !== "in_progress");
  const answers = done.length ? await scope.findMany(attemptAnswer, inArray(attemptAnswer.attemptId, done.map((a) => a.id))) : [];
  const unmarked = answers.filter((x) => x.marksAwarded === null && isAnswered(x.response)).length;
  if (unmarked) throw new MarkingError(`${unmarked} theory ${unmarked === 1 ? "answer still needs" : "answers still need"} marks.`);
  const students = done.length ? await scope.findMany(student, inArray(student.id, done.map((a) => a.studentId))) : [];

  const subjectIds = [...new Set(questions.map((q) => q.subjectId).filter((x): x is string => !!x))];
  const outOf = new Map(subjectIds.map((sid) => [sid, questions.filter((q) => q.subjectId === sid).reduce((s, q) => s + q.marks, 0)]));
  const qSubject = new Map(questions.map((q) => [q.id, q.subjectId]));
  // (class, subject) → changes
  const groups = new Map<string, { classArmId: string; subjectId: string; changes: { studentId: string; componentId: string; value: number }[] }>();
  for (const at of done) {
    const st = students.find((s) => s.id === at.studentId);
    if (!st?.classArmId) continue;
    for (const sid of subjectIds) {
      const got = answers.filter((x) => x.attemptId === at.id && qSubject.get(x.examQuestionId) === sid).reduce((s, x) => s + (x.marksAwarded ?? 0), 0);
      const key = `${st.classArmId}:${sid}`;
      const g = groups.get(key) ?? { classArmId: st.classArmId, subjectId: sid, changes: [] };
      g.changes.push({ studentId: st.id, componentId: component.id, value: scaleScore(got, outOf.get(sid)!, component.weight) });
      groups.set(key, g);
    }
  }
  let saved = 0;
  const skipped: string[] = [];
  for (const g of groups.values()) {
    try {
      saved += (await saveScores(scope, actor, { termId: component.termId, classArmId: g.classArmId, subjectId: g.subjectId, changes: g.changes, source: "attempt" })).saved;
    } catch (err) {
      skipped.push(err instanceof Error ? err.message : "skipped");
    }
  }
  await scope.update(exam, { scoresPushedAt: now }, eq(exam.id, examId));
  // Marking is final now: bring the bank's question statistics up to date.
  await refreshExamStats(scope, examId);
  return { students: done.length, saved, skipped, component: `${component.name} /${component.weight}`, absent: 0 };
}
