/**
 * Live monitor: who's where in an exam, each student's timeline, and the
 * invigilator's actions (extra time, reset session, force submit, start again,
 * count late answers). Every action is audit-logged with who did it.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { can, type Actor } from "@/lib/auth/permissions";
import { attempt, attemptAnswer, classArm, exam, examAssignment, examCandidate, examQuestion, integrityEvent, student } from "@/lib/db/schema";
import type { TenantScope } from "@/lib/tenant/scope";
import { departmentOf, examPhaseStatus } from "./builder";
import { describeEvent, monitorStatus, type EventType, type MonitorStatus, type Tone } from "./integrity";
import { validResponse } from "./rules";
import { finalizeAttempt, recordEvent, remarkAttempt } from "./runtime";

export class MonitorError extends Error {}

type Staff = { actor: Actor; name: string };

/** Admins, exam officers and the department's HOD see everyone; an invigilator sees their own rooms. */
export async function monitorAccess(scope: TenantScope, actor: Actor, examId: string) {
  const e = await scope.findFirst(exam, eq(exam.id, examId));
  if (!e || e.status === "draft") throw new MonitorError("Exam not found.");
  if (can(actor, "exam.monitor", { schoolId: scope.schoolId, departmentId: await departmentOf(scope, examId) })) return { exam: e, armIds: null as string[] | null };
  const mine = await scope.findMany(examAssignment, and(eq(examAssignment.examId, examId), eq(examAssignment.invigilatorId, actor.id)));
  if (!mine.length) throw new MonitorError("Exam not found.");
  return { exam: e, armIds: mine.map((m) => m.classArmId) };
}

export type MonitorStudent = {
  studentId: string;
  attemptId: string | null;
  name: string;
  admissionNo: string;
  className: string;
  seat: string | null;
  photoUrl: string | null;
  status: MonitorStatus;
  answered: number;
  total: number;
  currentIndex: number;
  flags: number;
  leaves: number;
  extraMinutes: number;
  deadlineAt: number | null;
  lastSeenAt: number | null;
  submitReason: string | null;
  lateCount: number;
};

export async function monitorData(scope: TenantScope, actor: Actor, examId: string, now = new Date()) {
  const { exam: e, armIds } = await monitorAccess(scope, actor, examId);
  const [rows, qCount, rooms] = await Promise.all([
    scope.query((db, owns) =>
      db
        .select({ c: examCandidate, s: student, armName: classArm.name, a: attempt })
        .from(examCandidate)
        .innerJoin(student, owns(student, eq(student.id, examCandidate.studentId)))
        .innerJoin(classArm, owns(classArm, eq(classArm.id, student.classArmId)))
        .leftJoin(attempt, owns(attempt, and(eq(attempt.examId, examCandidate.examId), eq(attempt.studentId, examCandidate.studentId))))
        .where(owns(examCandidate, and(eq(examCandidate.examId, examId), armIds ? inArray(student.classArmId, armIds) : undefined)))
        .orderBy(asc(examCandidate.seat)),
    ),
    scope.query(async (db, owns) => (await db.select({ n: sql<number>`count(*)::int` }).from(examQuestion).where(owns(examQuestion, eq(examQuestion.examId, examId))))[0].n),
    scope.query((db, owns) =>
      db
        .select({ venue: examAssignment.venue, name: classArm.name })
        .from(examAssignment)
        .innerJoin(classArm, owns(classArm, eq(classArm.id, examAssignment.classArmId)))
        .where(owns(examAssignment, and(eq(examAssignment.examId, examId), armIds ? inArray(examAssignment.classArmId, armIds) : undefined))),
    ),
  ]);
  const students: MonitorStudent[] = rows.map(({ c, s, armName, a }) => ({
    studentId: s.id,
    attemptId: a?.id ?? null,
    name: `${s.firstName} ${s.lastName}`,
    admissionNo: s.admissionNo,
    className: armName,
    seat: c.seat,
    photoUrl: s.photoUrl,
    status: monitorStatus(a, now),
    answered: a?.answeredCount ?? 0,
    total: a?.questionOrder.length || qCount,
    currentIndex: a?.currentIndex ?? 0,
    flags: a?.integrityFlags ?? 0,
    leaves: a?.leaveCount ?? 0,
    extraMinutes: Math.round((a?.extraSeconds ?? 0) / 60),
    deadlineAt: a?.deadlineAt.getTime() ?? null,
    lastSeenAt: a?.lastSeenAt?.getTime() ?? null,
    submitReason: a?.submitReason ?? null,
    lateCount: a?.lateAnswers?.length ?? 0,
  }));
  const counts = { progress: 0, notstarted: 0, submitted: 0, offline: 0, flagged: 0 } as Record<MonitorStatus, number>;
  for (const st of students) counts[st.status]++;
  return {
    exam: {
      id: e.id,
      title: e.title,
      fullTitle: e.fullTitle,
      phase: examPhaseStatus(e, now),
      windowStart: e.windowStart.getTime(),
      windowEnd: e.windowEnd.getTime(),
      lateEntryUntil: e.lateEntryUntil?.getTime() ?? null,
      durationMinutes: e.durationMinutes,
      rooms: [...new Set(rooms.map((r) => r.venue ?? e.venue).filter(Boolean))] as string[],
      classes: rooms.map((r) => r.name).sort(),
    },
    students,
    counts,
    scoped: !!armIds,
    serverNow: now.getTime(),
  };
}

export type TimelineEvent = { id: string; type: EventType; at: number; title: string; detail: string; tone: Tone; snapshot: boolean };

export async function studentTimeline(scope: TenantScope, actor: Actor, examId: string, studentId: string): Promise<TimelineEvent[]> {
  await allowedStudent(scope, actor, examId, studentId);
  const a = await scope.findFirst(attempt, and(eq(attempt.examId, examId), eq(attempt.studentId, studentId)));
  if (!a) return [];
  const events = await scope.findMany(integrityEvent, eq(integrityEvent.attemptId, a.id));
  return events
    .sort((x, y) => x.at.getTime() - y.at.getTime())
    .map((ev) => ({ id: ev.id, type: ev.type, at: ev.at.getTime(), snapshot: ev.type === "snapshot" && !!ev.meta?.key, ...describeEvent(ev.type, ev.meta) }));
}

async function allowedStudent(scope: TenantScope, actor: Actor, examId: string, studentId: string) {
  const { exam: e, armIds } = await monitorAccess(scope, actor, examId);
  const s = await scope.findFirst(student, eq(student.id, studentId));
  const seat = await scope.findFirst(examCandidate, and(eq(examCandidate.examId, examId), eq(examCandidate.studentId, studentId)));
  if (!s || !seat || (armIds && !armIds.includes(s.classArmId ?? ""))) throw new MonitorError("Student not found.");
  return { exam: e, student: s };
}

async function attemptOf(scope: TenantScope, examId: string, studentId: string) {
  const a = await scope.findFirst(attempt, and(eq(attempt.examId, examId), eq(attempt.studentId, studentId)));
  if (!a) throw new MonitorError("They haven't started yet.");
  return a;
}

const log = (scope: TenantScope, staff: Staff, action: string, attemptId: string, meta: Record<string, unknown>) =>
  scope.query((db) => audit(db, { schoolId: scope.schoolId, actorUserId: staff.actor.id, action, entityType: "attempt", entityId: attemptId, meta }));

/**
 * Extra time for one student (for an outage, say). If their time had already
 * run out and the exam was submitted for them, this reopens it.
 */
export async function addTime(scope: TenantScope, staff: Staff, examId: string, studentId: string, minutes: number, now = new Date()) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) throw new MonitorError("Add between 1 and 120 minutes.");
  await allowedStudent(scope, staff.actor, examId, studentId);
  const a = await attemptOf(scope, examId, studentId);
  if (a.status !== "in_progress" && a.submitReason !== "timeout") throw new MonitorError("Their exam has already been submitted.");
  const base = a.status === "in_progress" ? a.deadlineAt.getTime() : Math.max(a.deadlineAt.getTime(), now.getTime());
  await scope.update(
    attempt,
    { deadlineAt: new Date(base + minutes * 60_000), extraSeconds: a.extraSeconds + minutes * 60, ...(a.status !== "in_progress" ? { status: "in_progress" as const, submittedAt: null, submitReason: null } : {}) },
    eq(attempt.id, a.id),
  );
  await recordEvent(scope, a.id, "extra_time", { minutes, by: staff.name, reopened: a.status !== "in_progress" }, now);
  await log(scope, staff, "attempt.extra_time", a.id, { minutes, reopened: a.status !== "in_progress" });
}

/** Extra time for everyone still writing (and anyone yet to start: the window closes later too). */
export async function addTimeForEveryone(scope: TenantScope, staff: Staff, examId: string, minutes: number, now = new Date()) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) throw new MonitorError("Add between 1 and 120 minutes.");
  const { exam: e, armIds } = await monitorAccess(scope, staff.actor, examId);
  if (armIds) throw new MonitorError("Only the exam officer can add time for everyone.");
  const live = await scope.findMany(attempt, and(eq(attempt.examId, examId), eq(attempt.status, "in_progress")));
  await scope.transaction(async (tx) => {
    await tx.update(
      attempt,
      { deadlineAt: sql`${attempt.deadlineAt} + make_interval(mins => ${minutes})` as unknown as Date, extraSeconds: sql`${attempt.extraSeconds} + ${minutes * 60}` as unknown as number },
      and(eq(attempt.examId, examId), eq(attempt.status, "in_progress"))!,
    );
    await tx.update(exam, { windowEnd: new Date(e.windowEnd.getTime() + minutes * 60_000) }, eq(exam.id, examId));
    if (live.length) await tx.insert(integrityEvent, live.map((a) => ({ attemptId: a.id, type: "extra_time" as const, at: now, meta: { minutes, by: staff.name, everyone: true } })));
    await tx.query((db) => audit(db, { schoolId: tx.schoolId, actorUserId: staff.actor.id, action: "exam.extra_time", entityType: "exam", entityId: examId, meta: { minutes, attempts: live.length } }));
  });
  return live.length;
}

/** Lets the student carry on from any computer (the old one is no longer theirs). Answers are kept. */
export async function resetSession(scope: TenantScope, staff: Staff, examId: string, studentId: string, now = new Date()) {
  await allowedStudent(scope, staff.actor, examId, studentId);
  const a = await attemptOf(scope, examId, studentId);
  await scope.update(attempt, { deviceSessionId: null }, eq(attempt.id, a.id));
  await recordEvent(scope, a.id, "session_reset", { by: staff.name }, now);
  await log(scope, staff, "attempt.session_reset", a.id, {});
}

export async function forceSubmit(scope: TenantScope, staff: Staff, examId: string, studentId: string, reason: string, now = new Date()) {
  await allowedStudent(scope, staff.actor, examId, studentId);
  const a = await attemptOf(scope, examId, studentId);
  if (a.status !== "in_progress") throw new MonitorError("Their exam has already been submitted.");
  await finalizeAttempt(scope, a, "auto_submitted", now, "staff", { by: staff.name, reason: reason.slice(0, 200) || null });
  await log(scope, staff, "attempt.force_submit", a.id, { reason });
}

/** Throws the attempt away so the student starts again. Needs a reason; logged. */
export async function restartAttempt(scope: TenantScope, staff: Staff, examId: string, studentId: string, reason: string) {
  if (reason.trim().length < 3) throw new MonitorError("Give a reason. It goes in the audit log.");
  await allowedStudent(scope, staff.actor, examId, studentId);
  const a = await attemptOf(scope, examId, studentId);
  await scope.delete(attempt, eq(attempt.id, a.id));
  await log(scope, staff, "attempt.reset", a.id, { reason: reason.slice(0, 300), answered: a.answeredCount, status: a.status });
}

/** Counts answers that reached the server after time ran out (an outage, usually), then re-marks. */
export async function acceptLateAnswers(scope: TenantScope, staff: Staff, examId: string, studentId: string, now = new Date()) {
  await allowedStudent(scope, staff.actor, examId, studentId);
  const a = await attemptOf(scope, examId, studentId);
  const late = a.lateAnswers ?? [];
  if (!late.length) throw new MonitorError("There are no late answers.");
  const qs = await scope.findMany(examQuestion, and(eq(examQuestion.examId, examId), inArray(examQuestion.id, late.map((l) => l.examQuestionId))));
  const valid = late.filter((l) => {
    const q = qs.find((x) => x.id === l.examQuestionId);
    return q && validResponse(q.snapshot, l.response);
  });
  await scope.transaction(async (tx) => {
    if (valid.length) {
      await tx.query((db) =>
        db
          .insert(attemptAnswer)
          .values(valid.map((l) => ({ schoolId: tx.schoolId, attemptId: a.id, examQuestionId: l.examQuestionId, response: l.response, clientSeq: l.clientSeq, answeredAt: new Date(l.receivedAt) })))
          .onConflictDoUpdate({
            target: [attemptAnswer.attemptId, attemptAnswer.examQuestionId],
            set: { response: sql`excluded.response`, clientSeq: sql`excluded.client_seq`, answeredAt: sql`excluded.answered_at`, updatedAt: now },
            setWhere: sql`${attemptAnswer.clientSeq} < excluded.client_seq`,
          }),
      );
    }
    const [fresh] = await tx.update(attempt, { lateAnswers: null, clientSeq: Math.max(a.clientSeq, ...late.map((l) => l.clientSeq)) }, eq(attempt.id, a.id));
    if (fresh.status !== "in_progress") await remarkAttempt(tx, fresh);
    await recordEvent(tx, a.id, "late_answers_accepted", { count: valid.length, by: staff.name }, now);
    await tx.query((db) => audit(db, { schoolId: tx.schoolId, actorUserId: staff.actor.id, action: "attempt.late_answers", entityType: "attempt", entityId: a.id, meta: { count: valid.length } }));
  });
  return valid.length;
}

/** Live and today's exams this person can monitor. */
export async function monitorableExams(scope: TenantScope, actor: Actor, now = new Date()) {
  const from = new Date(now.getTime() - 12 * 3600_000);
  const to = new Date(now.getTime() + 36 * 3600_000);
  const rows = await scope.query((db, owns) =>
    db
      .select()
      .from(exam)
      .where(owns(exam, and(sql`${exam.status} <> 'draft'`, sql`${exam.windowEnd} > ${from}`, sql`${exam.windowStart} < ${to}`)))
      .orderBy(desc(sql`${exam.windowStart} <= ${now}`), asc(exam.windowStart)),
  );
  const out = [];
  for (const e of rows) {
    try {
      const { armIds } = await monitorAccess(scope, actor, e.id);
      out.push({ ...e, phase: examPhaseStatus(e, now), scoped: !!armIds });
    } catch {
      /* not theirs */
    }
  }
  return out;
}
