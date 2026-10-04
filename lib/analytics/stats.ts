import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { attempt, attemptAnswer, exam, examQuestion, questionStats } from "@/lib/db/schema";
import { round } from "@/lib/grading";
import type { TenantScope } from "@/lib/tenant/scope";

/** Answers are counted once the attempt has been handed in. */
export const DONE: ("submitted" | "auto_submitted")[] = ["submitted", "auto_submitted"];

/** Fewer answers than this and a question's figures say more about luck than the question. */
export const MIN_ANSWERS = 10;

export function difficultyFor(pctCorrect: number): "easy" | "medium" | "hard" {
  return pctCorrect >= 70 ? "easy" : pctCorrect >= 40 ? "medium" : "hard";
}

/**
 * Upper-minus-lower discrimination: the share of the top 27% of scorers who
 * got it right minus the share of the bottom 27%. Near 0 or negative means the
 * question doesn't separate strong from weak students.
 */
export function discrimination(rows: { scorePct: number; credit: number }[]): number | null {
  if (rows.length < MIN_ANSWERS) return null;
  const sorted = [...rows].sort((a, b) => b.scorePct - a.scorePct);
  const k = Math.max(1, Math.round(sorted.length * 0.27));
  const mean = (xs: typeof rows) => xs.reduce((a, r) => a + r.credit, 0) / xs.length;
  return round(mean(sorted.slice(0, k)) - mean(sorted.slice(-k)), 3);
}

/**
 * Recomputes the bank's question statistics (times used, % correct, computed
 * difficulty, discrimination, likely wrong key) from every handed-in answer.
 * Pass question ids to refresh only those.
 */
export async function refreshQuestionStats(scope: TenantScope, questionIds?: string[]) {
  const rows = await scope.query((db, owns) =>
    db
      .select({
        questionId: examQuestion.questionId,
        examId: examQuestion.examId,
        marks: examQuestion.marks,
        type: examQuestion.snapshot,
        windowStart: exam.windowStart,
        attemptId: attemptAnswer.attemptId,
        score: attempt.score,
        maxScore: attempt.maxScore,
        response: attemptAnswer.response,
        isCorrect: attemptAnswer.isCorrect,
        marksAwarded: attemptAnswer.marksAwarded,
      })
      .from(attemptAnswer)
      .innerJoin(attempt, owns(attempt, and(eq(attempt.id, attemptAnswer.attemptId), inArray(attempt.status, DONE))))
      .innerJoin(examQuestion, owns(examQuestion, eq(examQuestion.id, attemptAnswer.examQuestionId)))
      .innerJoin(exam, owns(exam, eq(exam.id, examQuestion.examId)))
      .where(owns(attemptAnswer, and(isNotNull(examQuestion.questionId), questionIds?.length ? inArray(examQuestion.questionId, questionIds) : undefined))),
  );
  const uses = await scope.query((db, owns) =>
    db
      .select({ questionId: examQuestion.questionId, examId: examQuestion.examId, windowStart: exam.windowStart })
      .from(examQuestion)
      .innerJoin(exam, owns(exam, and(eq(exam.id, examQuestion.examId), isNotNull(exam.publishedAt))))
      .where(owns(examQuestion, and(isNotNull(examQuestion.questionId), questionIds?.length ? inArray(examQuestion.questionId, questionIds) : undefined))),
  );

  type Row = (typeof rows)[number];
  const byQuestion = new Map<string, Row[]>();
  for (const r of rows) byQuestion.set(r.questionId!, [...(byQuestion.get(r.questionId!) ?? []), r]);
  const ids = new Set([...uses.map((u) => u.questionId!), ...byQuestion.keys()]);

  const out: (typeof questionStats.$inferInsert)[] = [];
  for (const qid of ids) {
    const mine = byQuestion.get(qid) ?? [];
    const answered = mine.filter((r) => r.response !== null && r.marksAwarded !== null);
    const credit = (r: Row) => (r.marks > 0 ? Math.min(1, (r.marksAwarded ?? 0) / r.marks) : 0);
    const pct = answered.length ? round((answered.reduce((a, r) => a + credit(r), 0) / answered.length) * 100, 2) : null;
    const scored = answered.map((r) => ({ scorePct: r.maxScore ? (r.score ?? 0) / r.maxScore : 0, credit: credit(r), r }));

    // Likely wrong key: hardly anyone gets it "right", and the strongest students prefer one other option.
    let wrongKey = false;
    const snap = mine[0]?.type;
    if (pct !== null && pct < 30 && answered.length >= MIN_ANSWERS && snap?.type === "mcq_single") {
      const top = [...scored].sort((a, b) => b.scorePct - a.scorePct).slice(0, Math.max(3, Math.round(scored.length * 0.27)));
      const counts = new Map<string, number>();
      for (const { r } of top) {
        const id = r.response?.kind === "choice" ? r.response.optionIds[0] : undefined;
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      const key = snap.options.find((o) => o.isCorrect)?.id;
      const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
      wrongKey = !!best && best !== key && n! > (counts.get(key ?? "") ?? 0) && n! >= top.length / 2;
    }

    const used = uses.filter((u) => u.questionId === qid);
    const values = {
      timesUsed: new Set(used.map((u) => u.examId)).size,
      attempts: answered.length,
      pctCorrect: pct,
      discrimination: discrimination(scored),
      computedDifficulty: pct !== null && answered.length >= MIN_ANSWERS ? difficultyFor(pct) : null,
      lastUsedAt: used.length ? new Date(Math.max(...used.map((u) => u.windowStart.getTime()))) : null,
      likelyWrongKey: wrongKey,
    };
    out.push({ schoolId: scope.schoolId, questionId: qid, ...values });
  }
  // One upsert per 500 questions rather than two round trips each.
  for (let i = 0; i < out.length; i += 500) {
    await scope.query((db) =>
      db
        .insert(questionStats)
        .values(out.slice(i, i + 500))
        .onConflictDoUpdate({
          target: questionStats.questionId,
          set: {
            timesUsed: sql`excluded.times_used`,
            attempts: sql`excluded.attempts`,
            pctCorrect: sql`excluded.pct_correct`,
            discrimination: sql`excluded.discrimination`,
            computedDifficulty: sql`excluded.computed_difficulty`,
            lastUsedAt: sql`excluded.last_used_at`,
            likelyWrongKey: sql`excluded.likely_wrong_key`,
            updatedAt: sql`now()`,
          },
          // Never touch another school's row (question ids are unique anyway).
          setWhere: eq(questionStats.schoolId, scope.schoolId),
        }),
    );
  }
  return { questions: ids.size };
}

/** Refreshes the statistics of the bank questions used in one exam. */
export async function refreshExamStats(scope: TenantScope, examId: string) {
  const ids = (await scope.findMany(examQuestion, eq(examQuestion.examId, examId))).map((q) => q.questionId).filter((x): x is string => !!x);
  return ids.length ? refreshQuestionStats(scope, ids) : { questions: 0 };
}
