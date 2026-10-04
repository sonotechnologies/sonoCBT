import { and, eq, inArray } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { can, type Actor } from "@/lib/auth/permissions";
import { classArm, reportCardExtras, scoreEntry } from "@/lib/db/schema";
import { computeClassResults } from "@/lib/grading";
import type { TenantScope } from "@/lib/tenant/scope";
import { extrasProblem, suggestPrincipalRemark, type ExtrasInput } from "./extras-model";
import { batchFor, getScale, ResultsError, studentsInArm } from "./pipeline";

/** Who may fill in this class's report-card extras, and whether they may still change them. */
export async function extrasAccess(scope: TenantScope, actor: Actor, termId: string, classArmId: string) {
  const arm = await scope.findFirst(classArm, eq(classArm.id, classArmId));
  if (!arm) throw new ResultsError("Class not found.");
  const admin = can(actor, "results.release", { schoolId: scope.schoolId });
  const formTeacher = can(actor, "reportCard.remarks", { schoolId: scope.schoolId, classArmId });
  const view = admin || formTeacher || can(actor, "results.review", { schoolId: scope.schoolId });
  const batch = await batchFor(scope, termId, classArmId);
  const open = batch.status === "draft" || batch.status === "under_review";
  return {
    arm,
    status: batch.status,
    view,
    /** Remarks, ratings and attendance. The form teacher can until the class is approved; the admin always. */
    edit: admin || (formTeacher && open),
    /** The principal's remark is the school admin's. */
    principal: admin,
  };
}

/** The class's students with their extras and average so far, for the editing screen. */
export async function classExtras(scope: TenantScope, actor: Actor, termId: string, classArmId: string) {
  const access = await extrasAccess(scope, actor, termId, classArmId);
  if (!access.view) throw new ResultsError("Class not found.");
  const students = await studentsInArm(scope, termId, classArmId);
  const ids = students.map((s) => s.id);
  const [rows, scores, scale] = await Promise.all([
    ids.length ? scope.findMany(reportCardExtras, and(eq(reportCardExtras.termId, termId), inArray(reportCardExtras.studentId, ids))!) : [],
    ids.length ? scope.findMany(scoreEntry, and(eq(scoreEntry.termId, termId), inArray(scoreEntry.studentId, ids))!) : [],
    getScale(scope),
  ]);
  const results = computeClassResults(scores, scale.bands);
  return {
    access: { status: access.status, edit: access.edit, principal: access.principal },
    arm: { id: access.arm.id, name: access.arm.name },
    students: students.map((s) => {
      const e = rows.find((r) => r.studentId === s.id);
      const r = results.students.get(s.id);
      return {
        id: s.id,
        name: `${s.firstName} ${s.lastName}`,
        admissionNo: s.admissionNo,
        average: r?.average ?? null,
        position: r?.position ?? null,
        extras: {
          formTeacherRemark: e?.formTeacherRemark ?? null,
          principalRemark: e?.principalRemark ?? null,
          affective: e?.affective ?? {},
          psychomotor: e?.psychomotor ?? {},
          daysPresent: e?.daysPresent ?? null,
          daysOpened: e?.daysOpened ?? null,
        },
      };
    }),
  };
}

async function upsert(scope: TenantScope, termId: string, studentId: string, set: Partial<typeof reportCardExtras.$inferInsert>) {
  const existing = await scope.findFirst(reportCardExtras, and(eq(reportCardExtras.termId, termId), eq(reportCardExtras.studentId, studentId))!);
  if (existing) await scope.update(reportCardExtras, set, eq(reportCardExtras.id, existing.id));
  else await scope.insert(reportCardExtras, { termId, studentId, ...set });
}

/** Saves one student's extras. Only the fields given are changed. */
export async function saveExtras(scope: TenantScope, actor: Actor, termId: string, classArmId: string, studentId: string, input: ExtrasInput) {
  const access = await extrasAccess(scope, actor, termId, classArmId);
  if (!access.edit) {
    throw new ResultsError(access.view ? "This class has been approved, so only the school admin can change its report cards now." : "Class not found.");
  }
  if (input.principalRemark !== undefined && !access.principal) throw new ResultsError("Only the school admin writes the principal's remark.");
  const students = await studentsInArm(scope, termId, classArmId);
  if (!students.some((s) => s.id === studentId)) throw new ResultsError("That student isn't in this class.");
  const clean: ExtrasInput = {
    ...input,
    formTeacherRemark: input.formTeacherRemark === undefined ? undefined : input.formTeacherRemark?.trim() || null,
    principalRemark: input.principalRemark === undefined ? undefined : input.principalRemark?.trim() || null,
  };
  const existing = await scope.findFirst(reportCardExtras, and(eq(reportCardExtras.termId, termId), eq(reportCardExtras.studentId, studentId))!);
  const problem = extrasProblem({
    daysPresent: clean.daysPresent === undefined ? existing?.daysPresent : clean.daysPresent,
    daysOpened: clean.daysOpened === undefined ? existing?.daysOpened : clean.daysOpened,
    ...clean,
  });
  if (problem) throw new ResultsError(problem);
  const set = Object.fromEntries(Object.entries(clean).filter(([, v]) => v !== undefined));
  await scope.transaction(async (tx) => {
    await upsert(tx, termId, studentId, set);
    // Changes after release are rare and worth a trail.
    if (access.status === "released" || access.status === "approved") {
      const batchId = (await batchFor(tx, termId, classArmId)).id;
      await tx.query((db) =>
        audit(db, {
          schoolId: scope.schoolId,
          actorUserId: actor.id,
          action: "report_card.change",
          entityType: "result_batch",
          entityId: batchId,
          meta: { termId, classArmId, studentId, fields: Object.keys(set) },
        }),
      );
    }
  });
}

/** Sets "times school opened" for everyone in the class. */
export async function setDaysOpened(scope: TenantScope, actor: Actor, termId: string, classArmId: string, days: number) {
  const access = await extrasAccess(scope, actor, termId, classArmId);
  if (!access.edit) throw new ResultsError("You can't change this class's report cards.");
  const students = await studentsInArm(scope, termId, classArmId);
  const rows = await scope.findMany(reportCardExtras, and(eq(reportCardExtras.termId, termId), inArray(reportCardExtras.studentId, students.map((s) => s.id).concat("00000000-0000-0000-0000-000000000000")))!);
  const tooFew = rows.find((r) => r.daysPresent !== null && r.daysPresent > days);
  const problem = extrasProblem({ daysOpened: days }) ?? (tooFew ? `A student was present ${tooFew.daysPresent} days, more than ${days}.` : null);
  if (problem) throw new ResultsError(problem);
  await scope.transaction(async (tx) => {
    for (const s of students) await upsert(tx, termId, s.id, { daysOpened: days });
  });
  return { updated: students.length };
}

/** Writes the suggested principal's remark for every student who doesn't have one yet. */
export async function fillPrincipalRemarks(scope: TenantScope, actor: Actor, termId: string, classArmId: string) {
  const data = await classExtras(scope, actor, termId, classArmId);
  if (!data.access.principal) throw new ResultsError("Only the school admin writes the principal's remark.");
  const todo = data.students.filter((s) => !s.extras.principalRemark && s.average !== null);
  await scope.transaction(async (tx) => {
    for (const s of todo) await upsert(tx, termId, s.id, { principalRemark: suggestPrincipalRemark(s.average!) });
  });
  return { filled: todo.length };
}
