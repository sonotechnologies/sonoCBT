import "server-only";
import { asc, eq } from "drizzle-orm";
import { can } from "@/lib/auth/permissions";
import { classLevel, subject, subjectOffering } from "@/lib/db/schema";
import type { TenantContext } from "@/lib/tenant/context";
import { listPassages, listTopics } from "./service";

/** Choices for the question editor and bank filters. A teacher's own subjects come first. */
export async function editorChoices(ctx: TenantContext) {
  const [subjects, levels, topics, passages, mine] = await Promise.all([
    ctx.scope.query((db, owns) =>
      db.select({ id: subject.id, name: subject.name, departmentId: subject.departmentId }).from(subject).where(owns(subject)).orderBy(asc(subject.sortOrder), asc(subject.name)),
    ),
    ctx.scope.query((db, owns) =>
      db.select({ id: classLevel.id, code: classLevel.code }).from(classLevel).where(owns(classLevel)).orderBy(asc(classLevel.sortOrder)),
    ),
    listTopics(ctx.scope),
    listPassages(ctx.scope),
    ctx.scope.findMany(subjectOffering, eq(subjectOffering.teacherId, ctx.user.id)),
  ]);
  const mySubjects = new Set(mine.map((o) => o.subjectId));
  const ordered = [...subjects.filter((s) => mySubjects.has(s.id)), ...subjects.filter((s) => !mySubjects.has(s.id))];
  // Subjects whose questions this person approves (HODs: their department's).
  const reviewSubjectIds = subjects
    .filter((s) => can(ctx.actor, "question.approve", { schoolId: ctx.school.id, departmentId: s.departmentId }))
    .map((s) => s.id);
  return {
    subjects: ordered.map(({ id, name }) => ({ id, name })),
    levels,
    topics,
    passages,
    mySubjectIds: [...mySubjects],
    reviewSubjectIds,
  };
}
