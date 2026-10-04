import { and, asc, eq, inArray } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { classArm, classLevel, subject, subjectOffering, user, userRole } from "@/lib/db/schema";
import type { TenantScope } from "@/lib/tenant/scope";

export type AllocationData = {
  arms: { id: string; name: string; offerings: { id: string; subject: string; teacherId: string | null }[] }[];
  teachers: { id: string; name: string }[];
};

/** Who teaches what: every class arm's subjects with their teacher. */
export async function getAllocation(scope: TenantScope): Promise<AllocationData> {
  return scope.query(async (db, owns) => {
    const [rows, teachers] = await Promise.all([
      db
        .select({
          id: subjectOffering.id,
          armId: classArm.id,
          arm: classArm.name,
          subject: subject.name,
          teacherId: subjectOffering.teacherId,
        })
        .from(subjectOffering)
        .innerJoin(classArm, owns(classArm, eq(classArm.id, subjectOffering.classArmId)))
        .innerJoin(classLevel, owns(classLevel, eq(classLevel.id, classArm.classLevelId)))
        .innerJoin(subject, owns(subject, eq(subject.id, subjectOffering.subjectId)))
        .where(owns(subjectOffering))
        .orderBy(asc(classLevel.sortOrder), asc(classArm.name), asc(subject.sortOrder), asc(subject.name)),
      teachersOf(scope),
    ]);
    const arms: AllocationData["arms"] = [];
    for (const r of rows) {
      let arm = arms.at(-1);
      if (arm?.id !== r.armId) arms.push((arm = { id: r.armId, name: r.arm, offerings: [] }));
      arm.offerings.push({ id: r.id, subject: r.subject, teacherId: r.teacherId });
    }
    return { arms, teachers };
  });
}

/** Staff in this school who hold the teacher role. */
export async function teachersOf(scope: TenantScope) {
  return scope.query((db) =>
    db
      .selectDistinct({ id: user.id, name: user.name })
      .from(userRole)
      .innerJoin(user, eq(user.id, userRole.userId))
      .where(and(eq(userRole.schoolId, scope.schoolId), inArray(userRole.role, ["teacher", "form_teacher"])))
      .orderBy(asc(user.name)),
  );
}

export async function setOfferingTeacher(scope: TenantScope, offeringId: string, teacherId: string | null, actorUserId: string) {
  if (teacherId && !(await teachersOf(scope)).some((t) => t.id === teacherId)) throw new Error("Not a teacher in this school");
  const [row] = await scope.update(subjectOffering, { teacherId }, eq(subjectOffering.id, offeringId));
  if (!row) throw new Error("Class subject not found");
  await scope.query((db) =>
    audit(db, { schoolId: scope.schoolId, actorUserId, action: "staff.allocation", entityType: "subject_offering", entityId: offeringId, meta: { teacherId } }),
  );
}
