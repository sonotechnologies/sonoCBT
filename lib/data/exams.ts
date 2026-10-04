import "server-only";
import { and, asc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { attempt, classArm, exam, examAssignment, examCandidate, examSection, examSubject, subject } from "@/lib/db/schema";
import type { Student } from "@/lib/tenant/context";
import type { TenantScope } from "@/lib/tenant/scope";

export type ExamRow = typeof exam.$inferSelect;

export type StudentExam = ExamRow & {
  subjects: { name: string; shortName: string }[];
  questionCount: number;
  sectionCount: number;
};

/** Exams assigned to the student's class arm (not drafts), with subjects and section totals. */
export async function listStudentExams(scope: TenantScope, student: Student): Promise<StudentExam[]> {
  if (!student.classArmId) return [];
  return scope.query(async (db, owns) => {
    const exams = await db
      .select({ exam })
      .from(exam)
      .innerJoin(
        examAssignment,
        owns(examAssignment, and(eq(examAssignment.examId, exam.id), eq(examAssignment.classArmId, student.classArmId!))),
      )
      .where(owns(exam, ne(exam.status, "draft")))
      .orderBy(asc(exam.windowStart));
    if (!exams.length) return [];
    const ids = exams.map((e) => e.exam.id);

    const [subjects, sections] = await Promise.all([
      db
        .select({ examId: examSubject.examId, name: subject.name, shortName: subject.shortName })
        .from(examSubject)
        .innerJoin(subject, owns(subject, eq(subject.id, examSubject.subjectId)))
        .where(owns(examSubject, inArray(examSubject.examId, ids)))
        .orderBy(asc(examSubject.sortOrder)),
      db
        .select({ examId: examSection.examId, questionCount: examSection.questionCount })
        .from(examSection)
        .where(owns(examSection, inArray(examSection.examId, ids))),
    ]);

    return exams.map(({ exam: e }) => {
      const secs = sections.filter((s) => s.examId === e.id);
      return {
        ...e,
        subjects: subjects
          .filter((s) => s.examId === e.id)
          .map((s) => ({ name: s.name, shortName: s.shortName ?? s.name })),
        questionCount: secs.reduce((a, s) => a + s.questionCount, 0),
        sectionCount: secs.length,
      };
    });
  });
}

export type ReleasedScore = { examId: string; title: string; releasedAt: Date; score: number; maxScore: number };

/** Submitted attempts whose scores the school has released to students. */
export function listReleasedScores(scope: TenantScope, studentId: string): Promise<ReleasedScore[]> {
  return scope.query(async (db, owns) => {
    const rows = await db
      .select({
        examId: exam.id,
        title: exam.title,
        releasedAt: exam.scoresReleasedAt,
        score: attempt.score,
        maxScore: attempt.maxScore,
      })
      .from(attempt)
      .innerJoin(exam, owns(exam, eq(exam.id, attempt.examId)))
      .where(
        owns(
          attempt,
          and(eq(attempt.studentId, studentId), isNotNull(attempt.submittedAt), isNotNull(exam.scoresReleasedAt)),
        ),
      );
    return rows
      .filter((r) => r.score !== null && r.maxScore !== null)
      .map((r) => ({ ...r, releasedAt: r.releasedAt!, score: r.score!, maxScore: r.maxScore! }))
      .sort((a, b) => b.releasedAt.getTime() - a.releasedAt.getTime());
  });
}

export async function hasSubmitted(scope: TenantScope, examId: string, studentId: string): Promise<boolean> {
  const row = await scope.findFirst(
    attempt,
    and(eq(attempt.examId, examId), eq(attempt.studentId, studentId), isNotNull(attempt.submittedAt)),
  );
  return !!row;
}

export async function getSeat(scope: TenantScope, examId: string, studentId: string): Promise<string | null> {
  const row = await scope.findFirst(examCandidate, and(eq(examCandidate.examId, examId), eq(examCandidate.studentId, studentId)));
  return row?.seat ?? null;
}

export async function getClassArmName(scope: TenantScope, classArmId: string | null): Promise<string | null> {
  if (!classArmId) return null;
  return (await scope.findFirst(classArm, eq(classArm.id, classArmId)))?.name ?? null;
}
