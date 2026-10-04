import { eq, inArray } from "drizzle-orm";
import { academicSession, assessmentComponent, classArm, classLevel, enrollment, scoreEntry, student, term } from "@/lib/db/schema";
import { round } from "@/lib/grading";
import { termLabel } from "@/lib/format";
import type { TenantScope } from "@/lib/tenant/scope";

export type TermInfo = { id: string; label: string; short: string; number: number; session: string; isCurrent: boolean };

/** Terms oldest → newest. */
export async function orderedTerms(scope: TenantScope): Promise<TermInfo[]> {
  const rows = await scope.query((db, owns) =>
    db
      .select({ id: term.id, number: term.number, session: academicSession.name, isCurrent: term.isCurrent })
      .from(term)
      .innerJoin(academicSession, owns(academicSession, eq(academicSession.id, term.sessionId)))
      .where(owns(term)),
  );
  return rows
    .sort((a, b) => a.session.localeCompare(b.session) || a.number - b.number)
    .map((r) => ({ ...r, label: termLabel(r.number, r.session), short: `${["", "1st", "2nd", "3rd"][r.number]} ${r.session.slice(2, 4)}/${r.session.slice(-2)}` }));
}

export type SubjectScore = { termId: string; studentId: string; subjectId: string; armId: string | null; arm: string; level: string; pct: number };

/**
 * Each student's percentage per subject per term from the CA grid, over the
 * parts entered so far (so a term half-way through isn't read as failing):
 * 18 out of the 30 marks entered is 60%.
 */
export async function subjectScores(scope: TenantScope, termIds: string[]): Promise<SubjectScore[]> {
  if (!termIds.length) return [];
  const [entries, comps, enrolled, students, arms, levels] = await Promise.all([
    scope.findMany(scoreEntry, inArray(scoreEntry.termId, termIds)),
    scope.findMany(assessmentComponent, inArray(assessmentComponent.termId, termIds)),
    scope.findMany(enrollment, inArray(enrollment.termId, termIds)),
    scope.findMany(student),
    scope.findMany(classArm),
    scope.findMany(classLevel),
  ]);
  const weight = new Map(comps.map((c) => [c.id, c.weight]));
  const agg = new Map<string, { termId: string; studentId: string; subjectId: string; got: number; of: number }>();
  for (const e of entries) {
    const k = `${e.termId}:${e.studentId}:${e.subjectId}`;
    const a = agg.get(k) ?? { termId: e.termId, studentId: e.studentId, subjectId: e.subjectId, got: 0, of: 0 };
    a.got += e.value;
    a.of += weight.get(e.componentId) ?? 0;
    agg.set(k, a);
  }
  const armIn = new Map(enrolled.map((e) => [`${e.termId}:${e.studentId}`, e.classArmId]));
  const current = new Map(students.map((s) => [s.id, s.classArmId]));
  const armName = new Map(arms.map((a) => [a.id, { name: a.name, level: levels.find((l) => l.id === a.classLevelId)?.code ?? "" }]));
  return [...agg.values()]
    .filter((a) => a.of > 0)
    .map((a) => {
      const armId = armIn.get(`${a.termId}:${a.studentId}`) ?? current.get(a.studentId) ?? null;
      const info = armId ? armName.get(armId) : undefined;
      return { termId: a.termId, studentId: a.studentId, subjectId: a.subjectId, armId, arm: info?.name ?? "—", level: info?.level ?? "—", pct: round((a.got / a.of) * 100, 1) };
    });
}

export const mean = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 1) : null);

/** Each student's average over their subjects. */
export function studentAverages(rows: SubjectScore[]) {
  const by = new Map<string, number[]>();
  for (const r of rows) by.set(r.studentId, [...(by.get(r.studentId) ?? []), r.pct]);
  return new Map([...by].map(([id, xs]) => [id, mean(xs)!]));
}

