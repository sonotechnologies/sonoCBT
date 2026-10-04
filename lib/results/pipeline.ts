/**
 * Results pipeline: term components and grading scale, the CA grid, the
 * broadsheet, and the release workflow (draft → in review → approved →
 * released). Every score change and status change is audit-logged.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { can, type Actor } from "@/lib/auth/permissions";
import {
  assessmentComponent,
  auditLog,
  classArm,
  classLevel,
  enrollment,
  gradeBand,
  gradingScale,
  resultBatch,
  scoreEntry,
  student,
  subject,
  subjectOffering,
  user,
} from "@/lib/db/schema";
import { computeClassResults, round, WAEC_BANDS, type GradeBand } from "@/lib/grading";
import type { TenantScope } from "@/lib/tenant/scope";
import { bandProblems, componentProblems, type ComponentInput } from "./rules";

export class ResultsError extends Error {}

type BatchStatus = (typeof resultBatch.$inferSelect)["status"];

// ─── Setup: components and grading scale ─────────────────────────────────────

export async function listComponents(scope: TenantScope, termId: string) {
  return (await scope.findMany(assessmentComponent, eq(assessmentComponent.termId, termId))).sort((a, b) => a.sortOrder - b.sortOrder);
}

export const STANDARD_COMPONENTS: ComponentInput[] = [
  { name: "CA1", weight: 10 },
  { name: "CA2", weight: 10 },
  { name: "Assignment", weight: 10 },
  { name: "Project", weight: 10 },
  { name: "Exam", weight: 60 },
];

/** Replaces a term's components. A component that already has scores can't be removed or made smaller than its highest score. */
export async function saveComponents(scope: TenantScope, actor: Actor, termId: string, list: ComponentInput[]) {
  if (!can(actor, "school.manage", { schoolId: scope.schoolId })) throw new ResultsError("Only the school admin can change how results add up.");
  const problem = componentProblems(list);
  if (problem) throw new ResultsError(problem);
  const existing = await listComponents(scope, termId);
  const used = await scope.query((db, owns) =>
    db
      .select({ componentId: scoreEntry.componentId, max: sql<number>`max(${scoreEntry.value})::float`, n: sql<number>`count(*)::int` })
      .from(scoreEntry)
      .where(owns(scoreEntry, eq(scoreEntry.termId, termId)))
      .groupBy(scoreEntry.componentId),
  );
  for (const c of existing) {
    const u = used.find((x) => x.componentId === c.id);
    const kept = list.find((x) => x.id === c.id);
    if (u && !kept) throw new ResultsError(`"${c.name}" already has ${u.n} scores, so it can't be removed.`);
    if (u && kept && kept.weight < u.max) throw new ResultsError(`"${c.name}" already has a score of ${u.max}, so it can't be out of less than that.`);
  }
  await scope.transaction(async (tx) => {
    const keep = list.filter((c) => c.id && existing.some((e) => e.id === c.id));
    const gone = existing.filter((e) => !keep.some((k) => k.id === e.id));
    if (gone.length) await tx.delete(assessmentComponent, inArray(assessmentComponent.id, gone.map((g) => g.id)));
    for (const [i, c] of list.entries()) {
      if (c.id && keep.some((k) => k.id === c.id)) await tx.update(assessmentComponent, { name: c.name.trim(), weight: c.weight, sortOrder: i + 1 }, eq(assessmentComponent.id, c.id));
      else await tx.insert(assessmentComponent, { termId, name: c.name.trim(), weight: c.weight, sortOrder: i + 1 });
    }
    await tx.query((db) => audit(db, { schoolId: tx.schoolId, actorUserId: actor.id, action: "results.components", entityType: "term", entityId: termId, meta: { components: list.map((c) => `${c.name} ${c.weight}`) } }));
  });
}

/** The school's grading scale (WAEC A1–F9 until changed). */
export async function getScale(scope: TenantScope): Promise<{ id: string | null; bands: GradeBand[] }> {
  const scale = (await scope.findFirst(gradingScale, eq(gradingScale.isDefault, true))) ?? (await scope.findFirst(gradingScale));
  if (!scale) return { id: null, bands: WAEC_BANDS };
  const bands = await scope.findMany(gradeBand, eq(gradeBand.scaleId, scale.id));
  return { id: scale.id, bands: bands.length ? bands.map((b) => ({ min: b.min, max: b.max, grade: b.grade, remark: b.remark })).sort((a, b) => b.min - a.min) : WAEC_BANDS };
}

export async function saveScale(scope: TenantScope, actor: Actor, bands: GradeBand[]) {
  if (!can(actor, "school.manage", { schoolId: scope.schoolId })) throw new ResultsError("Only the school admin can change the grading scale.");
  const clean = bands.map((b) => ({ min: round(Number(b.min), 2), max: round(Number(b.max), 2), grade: b.grade.trim(), remark: b.remark.trim().slice(0, 40) }));
  const problem = bandProblems(clean);
  if (problem) throw new ResultsError(problem);
  const { id } = await getScale(scope);
  await scope.transaction(async (tx) => {
    const scaleId = id ?? (await tx.insert(gradingScale, { name: "School scale", isDefault: true }))[0].id;
    await tx.delete(gradeBand, eq(gradeBand.scaleId, scaleId));
    await tx.insert(gradeBand, clean.map((b) => ({ ...b, scaleId })));
    await tx.query((db) => audit(db, { schoolId: tx.schoolId, actorUserId: actor.id, action: "results.scale", entityType: "grading_scale", entityId: scaleId, meta: { bands: clean.map((b) => `${b.grade} ${b.min}–${b.max}`) } }));
  });
}

// ─── Who's in a class, and who may do what ──────────────────────────────────

/** Students in a class arm for a term: from enrolment if recorded, else the current class list. */
export async function studentsInArm(scope: TenantScope, termId: string, classArmId: string) {
  const enrolled = await scope.findMany(enrollment, and(eq(enrollment.termId, termId), eq(enrollment.classArmId, classArmId)));
  const rows = enrolled.length
    ? await scope.findMany(student, inArray(student.id, enrolled.map((e) => e.studentId)))
    : await scope.findMany(student, eq(student.classArmId, classArmId));
  return rows.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
}

async function armOf(scope: TenantScope, classArmId: string) {
  const arm = await scope.findFirst(classArm, eq(classArm.id, classArmId));
  if (!arm) throw new ResultsError("Class not found.");
  return arm;
}

/** Subject teacher for this class, or someone who moderates marks (HOD for the department, exam officer, admin). */
export async function canEnterScores(scope: TenantScope, actor: Actor, classArmId: string, subjectId: string) {
  const subj = await scope.findFirst(subject, eq(subject.id, subjectId));
  if (!subj) return { enter: false, moderate: false };
  const offering = await scope.findFirst(subjectOffering, and(eq(subjectOffering.classArmId, classArmId), eq(subjectOffering.subjectId, subjectId)));
  const moderate = can(actor, "marks.moderate", { schoolId: scope.schoolId, departmentId: subj.departmentId });
  return { enter: moderate || can(actor, "marks.enter", { schoolId: scope.schoolId, teacherId: offering?.teacherId ?? null }), moderate };
}

export async function batchFor(scope: TenantScope, termId: string, classArmId: string) {
  return (
    (await scope.findFirst(resultBatch, and(eq(resultBatch.termId, termId), eq(resultBatch.classArmId, classArmId)))) ??
    (await scope.insert(resultBatch, { termId, classArmId, status: "draft" }))[0]
  );
}

// ─── CA grid ─────────────────────────────────────────────────────────────────

export async function gridData(scope: TenantScope, actor: Actor, termId: string, classArmId: string, subjectId: string) {
  const arm = await armOf(scope, classArmId);
  const access = await canEnterScores(scope, actor, classArmId, subjectId);
  const isFormTeacher = actor.roles.some((r) => r.role === "form_teacher" && r.classArmId === classArmId);
  if (!access.enter && !isFormTeacher && !can(actor, "results.review", { schoolId: scope.schoolId })) throw new ResultsError("Class not found.");
  const [components, students, batch, subj, scale] = await Promise.all([
    listComponents(scope, termId),
    studentsInArm(scope, termId, classArmId),
    batchFor(scope, termId, classArmId),
    scope.findFirst(subject, eq(subject.id, subjectId)),
    getScale(scope),
  ]);
  const scores = students.length
    ? await scope.findMany(scoreEntry, and(eq(scoreEntry.termId, termId), eq(scoreEntry.subjectId, subjectId), inArray(scoreEntry.studentId, students.map((s) => s.id))))
    : [];
  const locked = batch.status !== "draft";
  return {
    arm: { id: arm.id, name: arm.name },
    subject: { id: subjectId, name: subj?.name ?? "" },
    components: components.map((c) => ({ id: c.id, name: c.name, weight: c.weight })),
    students: students.map((s) => ({
      id: s.id,
      name: `${s.firstName} ${s.lastName}`,
      admissionNo: s.admissionNo,
      values: Object.fromEntries(scores.filter((x) => x.studentId === s.id).map((x) => [x.componentId, x.value])) as Record<string, number>,
      sources: Object.fromEntries(scores.filter((x) => x.studentId === s.id).map((x) => [x.componentId, x.source])) as Record<string, string>,
    })),
    bands: scale.bands,
    status: batch.status,
    // Teachers type while the class is in draft; after that only a moderator can, with a reason.
    canEdit: access.enter && (!locked || access.moderate),
    needsReason: locked && access.moderate,
  };
}

export type CellChange = { studentId: string; componentId: string; value: number | null };

export async function saveScores(
  scope: TenantScope,
  actor: Actor,
  args: { termId: string; classArmId: string; subjectId: string; changes: CellChange[]; reason?: string; source?: "manual" | "import" | "attempt" },
): Promise<{ saved: number }> {
  const { termId, classArmId, subjectId } = args;
  const access = await canEnterScores(scope, actor, classArmId, subjectId);
  if (!access.enter) throw new ResultsError("You can't enter scores for this class and subject.");
  const batch = await batchFor(scope, termId, classArmId);
  if (batch.status !== "draft") {
    if (!access.moderate) throw new ResultsError("This class has been sent for review, so scores are locked. Ask the exam officer.");
    if (!args.reason || args.reason.trim().length < 3) throw new ResultsError("Give a reason for changing a score after review. It goes in the change log.");
  }
  if (args.changes.length > 2000) throw new ResultsError("Too many changes at once.");
  const [components, students] = await Promise.all([listComponents(scope, termId), studentsInArm(scope, termId, classArmId)]);
  const weight = new Map(components.map((c) => [c.id, c.weight]));
  const inClass = new Set(students.map((s) => s.id));
  for (const c of args.changes) {
    if (!inClass.has(c.studentId)) throw new ResultsError("A student isn't in this class.");
    if (!weight.has(c.componentId)) throw new ResultsError("That component isn't part of this term.");
    if (c.value !== null && !(Number.isFinite(c.value) && c.value >= 0 && c.value <= weight.get(c.componentId)!)) {
      throw new ResultsError(`Scores must be from 0 to ${weight.get(c.componentId)}.`);
    }
  }
  const before = await scope.findMany(
    scoreEntry,
    and(eq(scoreEntry.termId, termId), eq(scoreEntry.subjectId, subjectId), inArray(scoreEntry.studentId, [...new Set(args.changes.map((c) => c.studentId)), "00000000-0000-0000-0000-000000000000"])),
  );
  const prev = new Map(before.map((b) => [`${b.studentId}:${b.componentId}`, b.value]));
  const real = args.changes.filter((c) => (prev.get(`${c.studentId}:${c.componentId}`) ?? null) !== (c.value === null ? null : round(c.value, 2)));
  if (!real.length) return { saved: 0 };
  await scope.transaction(async (tx) => {
    const sets = real.filter((c) => c.value !== null);
    const clears = real.filter((c) => c.value === null);
    if (sets.length) {
      await tx.query((db) =>
        db
          .insert(scoreEntry)
          .values(sets.map((c) => ({ schoolId: tx.schoolId, termId, studentId: c.studentId, subjectId, componentId: c.componentId, value: round(c.value!, 2), source: args.source ?? "manual" })))
          .onConflictDoUpdate({ target: [scoreEntry.studentId, scoreEntry.subjectId, scoreEntry.componentId], set: { value: sql`excluded.value`, source: sql`excluded.source`, updatedAt: new Date() } }),
      );
    }
    for (const c of clears) {
      await tx.delete(scoreEntry, and(eq(scoreEntry.studentId, c.studentId), eq(scoreEntry.subjectId, subjectId), eq(scoreEntry.componentId, c.componentId), eq(scoreEntry.termId, termId))!);
    }
    const edits = real
      .filter((c) => prev.has(`${c.studentId}:${c.componentId}`))
      .map((c) => ({ studentId: c.studentId, componentId: c.componentId, from: prev.get(`${c.studentId}:${c.componentId}`), to: c.value }));
    await tx.query((db) =>
      audit(db, {
        schoolId: tx.schoolId,
        actorUserId: actor.id,
        action: args.source === "attempt" ? "scores.import_exam" : "scores.save",
        entityType: "result_batch",
        entityId: batch.id,
        meta: { termId, classArmId, subjectId, count: real.length, edits: edits.slice(0, 50), reason: args.reason?.trim() || null, status: batch.status },
      }),
    );
  });
  return { saved: real.length };
}

// ─── Broadsheet ──────────────────────────────────────────────────────────────

export async function broadsheet(scope: TenantScope, actor: Actor, termId: string, classArmId: string) {
  const arm = await armOf(scope, classArmId);
  const offerings = await scope.findMany(subjectOffering, eq(subjectOffering.classArmId, classArmId));
  const mine = offerings.some((o) => o.teacherId === actor.id);
  const isFormTeacher = actor.roles.some((r) => r.role === "form_teacher" && r.classArmId === classArmId);
  if (!mine && !isFormTeacher && !can(actor, "results.review", { schoolId: scope.schoolId }) && !can(actor, "marks.moderate", { schoolId: scope.schoolId })) {
    throw new ResultsError("Class not found.");
  }
  const [students, components, scale] = await Promise.all([studentsInArm(scope, termId, classArmId), listComponents(scope, termId), getScale(scope)]);
  const scores = students.length ? await scope.findMany(scoreEntry, and(eq(scoreEntry.termId, termId), inArray(scoreEntry.studentId, students.map((s) => s.id)))) : [];
  const subjectIds = [...new Set([...offerings.map((o) => o.subjectId), ...scores.map((s) => s.subjectId)])];
  const subjects = subjectIds.length ? (await scope.findMany(subject, inArray(subject.id, subjectIds))).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)) : [];
  const results = computeClassResults(
    scores.map((s) => ({ studentId: s.studentId, subjectId: s.subjectId, componentId: s.componentId, value: s.value })),
    scale.bands,
  );
  const compIds = components.map((c) => c.id);
  // A subject is ready when every student has every component.
  const ready = subjects.map((sub) => ({
    subjectId: sub.id,
    complete: students.length > 0 && students.every((st) => compIds.every((cid) => scores.some((x) => x.studentId === st.id && x.subjectId === sub.id && x.componentId === cid))),
  }));
  return {
    arm: { id: arm.id, name: arm.name },
    subjects: subjects.map((s) => ({ id: s.id, name: s.name, shortName: s.shortName ?? s.name, ready: ready.find((r) => r.subjectId === s.id)!.complete })),
    students: students.map((st) => {
      const r = results.students.get(st.id);
      return {
        id: st.id,
        name: `${st.firstName} ${st.lastName}`,
        admissionNo: st.admissionNo,
        // complete: every part is in, so the total is final (a partial total isn't a fail yet).
        subjects: Object.fromEntries(
          (r?.subjects ?? []).map((x) => [x.subjectId, { total: x.total, grade: x.grade, position: x.position, complete: compIds.every((cid) => scores.some((e) => e.studentId === st.id && e.subjectId === x.subjectId && e.componentId === cid)) }]),
        ) as Record<string, { total: number; grade: string; position: number; complete: boolean }>,
        total: r?.total ?? null,
        average: r?.average ?? null,
        position: r?.position ?? null,
      };
    }),
    numberInClass: results.numberInClass,
    subjectsReady: ready.filter((r) => r.complete).length,
  };
}

// ─── Release workflow ────────────────────────────────────────────────────────

const STATUS_WORD: Record<BatchStatus, string> = { draft: "Draft", under_review: "In review", approved: "Approved", released: "Released" };

export async function releaseOverview(scope: TenantScope, termId: string) {
  const [arms, batches, components] = await Promise.all([
    scope.query((db, owns) =>
      db
        .select({ id: classArm.id, name: classArm.name, sort: classLevel.sortOrder, level: classLevel.code })
        .from(classArm)
        .innerJoin(classLevel, owns(classLevel, eq(classLevel.id, classArm.classLevelId)))
        .where(owns(classArm))
        .orderBy(asc(classLevel.sortOrder), asc(classArm.name)),
    ),
    scope.findMany(resultBatch, eq(resultBatch.termId, termId)),
    listComponents(scope, termId),
  ]);
  const compN = components.length;
  const rows = [];
  for (const a of arms) {
    const [students, offerings] = await Promise.all([studentsInArm(scope, termId, a.id), scope.findMany(subjectOffering, eq(subjectOffering.classArmId, a.id))]);
    const subjectIds = [...new Set(offerings.map((o) => o.subjectId))];
    const ids = students.map((s) => s.id);
    const counts = ids.length && subjectIds.length
      ? await scope.query((db, owns) =>
          db
            .select({ subjectId: scoreEntry.subjectId, n: sql<number>`count(*)::int` })
            .from(scoreEntry)
            .where(owns(scoreEntry, and(eq(scoreEntry.termId, termId), inArray(scoreEntry.studentId, ids), inArray(scoreEntry.subjectId, subjectIds))))
            .groupBy(scoreEntry.subjectId),
        )
      : [];
    const ready = subjectIds.filter((sid) => (counts.find((c) => c.subjectId === sid)?.n ?? 0) >= ids.length * compN && compN > 0 && ids.length > 0).length;
    const batch = batches.find((b) => b.classArmId === a.id);
    const last = batch
      ? await scope.query((db) =>
          db
            .select({ at: auditLog.createdAt, who: user.name })
            .from(auditLog)
            .leftJoin(user, eq(user.id, auditLog.actorUserId))
            .where(and(eq(auditLog.schoolId, scope.schoolId), eq(auditLog.entityId, batch.id)))
            .orderBy(desc(auditLog.createdAt))
            .limit(1),
        )
      : [];
    rows.push({
      classArmId: a.id,
      name: a.name,
      level: a.level,
      students: ids.length,
      subjectsReady: ready,
      subjectsTotal: subjectIds.length,
      status: batch?.status ?? ("draft" as BatchStatus),
      lastBy: last[0]?.who ?? null,
      lastAt: last[0]?.at ?? batch?.updatedAt ?? null,
    });
  }
  return { rows, statusWord: STATUS_WORD };
}

const ALLOWED: Record<string, { from: BatchStatus[]; to: BatchStatus; check: (scope: TenantScope, actor: Actor, armId: string) => boolean }> = {
  submit: {
    from: ["draft"],
    to: "under_review",
    check: (scope, actor, armId) =>
      can(actor, "results.review", { schoolId: scope.schoolId }) || can(actor, "marks.moderate", { schoolId: scope.schoolId }) || actor.roles.some((r) => r.role === "form_teacher" && r.classArmId === armId),
  },
  approve: { from: ["under_review"], to: "approved", check: (scope, actor) => can(actor, "results.review", { schoolId: scope.schoolId }) },
  send_back: { from: ["under_review", "approved"], to: "draft", check: (scope, actor) => can(actor, "results.review", { schoolId: scope.schoolId }) },
  release: { from: ["approved"], to: "released", check: (scope, actor) => can(actor, "results.release", { schoolId: scope.schoolId }) },
  unrelease: { from: ["released"], to: "approved", check: (scope, actor) => can(actor, "results.release", { schoolId: scope.schoolId }) },
};
export type BatchAction = "submit" | "approve" | "send_back" | "release" | "unrelease";
const PAST: Record<BatchAction, string> = { submit: "sent for review", approve: "approved", send_back: "sent back", release: "released", unrelease: "un-released" };

/** Moves classes along the workflow. Sending back and un-releasing need a reason. */
export async function moveBatches(scope: TenantScope, actor: Actor, termId: string, classArmIds: string[], action: BatchAction, reason?: string, now = new Date()) {
  const rule = ALLOWED[action];
  if (!rule) throw new ResultsError("Unknown action.");
  if ((action === "send_back" || action === "unrelease") && (!reason || reason.trim().length < 3)) throw new ResultsError("Give a reason. It goes in the change log.");
  if (!classArmIds.length) throw new ResultsError("Choose at least one class.");
  for (const armId of classArmIds) {
    await armOf(scope, armId);
    if (!rule.check(scope, actor, armId)) throw new ResultsError("You can't do that.");
  }
  await scope.transaction(async (tx) => {
    for (const armId of classArmIds) {
      const b = await batchFor(tx, termId, armId);
      if (!rule.from.includes(b.status)) throw new ResultsError(`${(await armOf(tx, armId)).name} is ${STATUS_WORD[b.status].toLowerCase()}, so it can't be ${PAST[action]}.`);
      await tx.update(
        resultBatch,
        { status: rule.to, ...(rule.to === "released" ? { releasedAt: now, releasedBy: actor.id } : rule.to === "approved" && action === "unrelease" ? { releasedAt: null } : {}) },
        eq(resultBatch.id, b.id),
      );
      await tx.query((db) =>
        audit(db, { schoolId: tx.schoolId, actorUserId: actor.id, action: `results.${action}`, entityType: "result_batch", entityId: b.id, meta: { termId, classArmId: armId, from: b.status, to: rule.to, reason: reason?.trim() || null } }),
      );
    }
  });
}

/** The class's change log: score saves, exam imports and status changes, newest first. */
const FIELD_NAMES: Record<string, string> = {
  formTeacherRemark: "form teacher's remark",
  principalRemark: "principal's remark",
  affective: "affective ratings",
  psychomotor: "psychomotor ratings",
  daysPresent: "days present",
  daysOpened: "days opened",
};

export async function changeLog(scope: TenantScope, termId: string, classArmId: string, limit = 30) {
  const b = await scope.findFirst(resultBatch, and(eq(resultBatch.termId, termId), eq(resultBatch.classArmId, classArmId)));
  if (!b) return [];
  const rows = await scope.query((db) =>
    db
      .select({ at: auditLog.createdAt, action: auditLog.action, meta: auditLog.meta, who: user.name })
      .from(auditLog)
      .leftJoin(user, eq(user.id, auditLog.actorUserId))
      .where(and(eq(auditLog.schoolId, scope.schoolId), eq(auditLog.entityId, b.id)))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit),
  );
  const subjectIds = [...new Set(rows.map((r) => (r.meta as Record<string, unknown> | null)?.subjectId).filter((x): x is string => typeof x === "string"))];
  const names = new Map((subjectIds.length ? await scope.findMany(subject, inArray(subject.id, subjectIds)) : []).map((s) => [s.id, s.name]));
  return rows.map((r) => {
    const m = (r.meta ?? {}) as Record<string, unknown>;
    const sub = typeof m.subjectId === "string" ? names.get(m.subjectId) ?? "a subject" : "";
    const why = m.reason ? ` (${m.reason})` : "";
    const what =
      r.action === "scores.save"
        ? `Saved ${m.count} ${sub} ${m.count === 1 ? "score" : "scores"}${(m.edits as unknown[] | undefined)?.length ? `, ${(m.edits as unknown[]).length} changed` : ""}${why}`
        : r.action === "scores.import_exam"
          ? `Imported ${sub} exam scores from CBT (${m.count} students)`
          : r.action === "results.submit"
            ? "Sent for review"
            : r.action === "results.approve"
              ? "Approved"
              : r.action === "results.send_back"
                ? `Sent back to teachers${why}`
                : r.action === "results.release"
                  ? "Released to students and parents"
                  : r.action === "results.unrelease"
                    ? `Un-released${why}`
                    : r.action === "report_card.change"
                      ? `Changed a report card (${((m.fields as string[] | undefined) ?? []).map((f) => FIELD_NAMES[f] ?? f).join(", ")})`
                      : r.action;
    return { at: r.at, who: r.who ?? "System", what };
  });
}
