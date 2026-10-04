import "server-only";
import { asc, eq } from "drizzle-orm";
import { listTerms } from "@/lib/data/terms";
import { assessmentComponent, classArm, classLevel, subject, topic } from "@/lib/db/schema";
import { teachersOf } from "@/lib/staff/allocation";
import type { TenantScope } from "@/lib/tenant/scope";

/** Everything the exam builder's pickers offer. */
export async function builderChoices(scope: TenantScope) {
  const [terms, subjects, arms, levels, topics, teachers, components] = await Promise.all([
    listTerms(scope),
    scope.query((db, owns) => db.select({ id: subject.id, name: subject.name }).from(subject).where(owns(subject)).orderBy(asc(subject.sortOrder), asc(subject.name))),
    scope.query((db, owns) =>
      db
        .select({ id: classArm.id, name: classArm.name, level: classLevel.code, levelId: classLevel.id, sort: classLevel.sortOrder })
        .from(classArm)
        .innerJoin(classLevel, owns(classLevel, eq(classLevel.id, classArm.classLevelId)))
        .where(owns(classArm))
        .orderBy(asc(classLevel.sortOrder), asc(classArm.name)),
    ),
    scope.query((db, owns) => db.select({ id: classLevel.id, code: classLevel.code }).from(classLevel).where(owns(classLevel)).orderBy(asc(classLevel.sortOrder))),
    scope.query((db, owns) =>
      db.select({ id: topic.id, name: topic.name, subjectId: topic.subjectId, classLevelId: topic.classLevelId }).from(topic).where(owns(topic)).orderBy(asc(topic.name)),
    ),
    teachersOf(scope),
    scope.findMany(assessmentComponent),
  ]);
  return {
    terms: terms.map((t) => ({ id: t.id, label: t.label, isCurrent: t.isCurrent })),
    subjects,
    arms: arms.map((a) => ({ id: a.id, name: a.name, level: a.level, levelId: a.levelId })),
    levels,
    topics,
    teachers,
    components: components.sort((a, b) => a.sortOrder - b.sortOrder).map((c) => ({ id: c.id, termId: c.termId, name: c.name, weight: c.weight })),
  };
}
