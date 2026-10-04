import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { can, type Actor } from "@/lib/auth/permissions";
import { academicSession, auditLog, classArm, classLevel, enrollment, session, student, term, user } from "@/lib/db/schema";
import { lagosDayKey } from "@/lib/format";
import type { TenantScope } from "@/lib/tenant/scope";

export class MoveError extends Error {}

/** Where a class (or one student) goes at promotion: another class, the same class, or out of the school. */
export type Target = { kind: "arm"; armId: string } | { kind: "stay" } | { kind: "graduate" } | { kind: "left" };

function guard(scope: TenantScope, actor: Actor) {
  if (!can(actor, "student.manage", { schoolId: scope.schoolId })) throw new MoveError("Only the school admin can move students between classes.");
}

async function currentTerm(scope: TenantScope) {
  const [cur] = await scope.query((db, owns) =>
    db
      .select({ id: term.id, number: term.number, sessionId: term.sessionId, sessionName: academicSession.name })
      .from(term)
      .innerJoin(academicSession, owns(academicSession, eq(academicSession.id, term.sessionId)))
      .where(owns(term, eq(term.isCurrent, true))),
  );
  return cur ?? null;
}

/**
 * Before a student's class changes, writes down the class they were in for
 * every term that has already started (and has no record yet), so last term's
 * broadsheet and report card stay with the class they sat in.
 */
async function recordHistory(tx: TenantScope, studentIds: string[], opts: { includeCurrent: boolean; now: Date }) {
  if (!studentIds.length) return;
  const today = lagosDayKey(opts.now);
  const terms = await tx.findMany(term, or(isNull(term.startsOn), lte(term.startsOn, today))!);
  const termIds = terms.filter((t) => opts.includeCurrent || !t.isCurrent).map((t) => t.id);
  if (!termIds.length) return;
  const people = await tx.findMany(student, and(inArray(student.id, studentIds), sql`${student.classArmId} is not null`)!);
  const rows = people.flatMap((s) => termIds.map((termId) => ({ schoolId: tx.schoolId, studentId: s.id, termId, classArmId: s.classArmId! })));
  for (let i = 0; i < rows.length; i += 2000) {
    await tx.query((db) => db.insert(enrollment).values(rows.slice(i, i + 2000)).onConflictDoNothing());
  }
}

/** Puts students in a class for the current term (replacing any record for it). */
async function enrolNow(tx: TenantScope, termId: string, pairs: { studentId: string; armId: string }[]) {
  if (!pairs.length) return;
  for (let i = 0; i < pairs.length; i += 2000) {
    await tx.query((db) =>
      db
        .insert(enrollment)
        .values(pairs.slice(i, i + 2000).map((p) => ({ schoolId: tx.schoolId, studentId: p.studentId, termId, classArmId: p.armId })))
        .onConflictDoUpdate({ target: [enrollment.studentId, enrollment.termId], set: { classArmId: sql`excluded.class_arm_id`, updatedAt: sql`now()` } }),
    );
  }
}

/** Graduated and left students can't sign in (their results stay for parents and the school). */
async function setSignIn(tx: TenantScope, studentIds: string[], allowed: boolean, reason?: string) {
  if (!studentIds.length) return;
  const rows = await tx.findMany(student, inArray(student.id, studentIds));
  const userIds = rows.map((r) => r.userId).filter((x): x is string => !!x);
  if (!userIds.length) return;
  await tx.query(async (db) => {
    await db.update(user).set({ banned: !allowed, banReason: allowed ? null : (reason ?? null) }).where(and(inArray(user.id, userIds), eq(user.schoolId, tx.schoolId)));
    if (!allowed) await db.delete(session).where(inArray(session.userId, userIds));
  });
}

// ─── Promotion at the start of a new session ──────────────────────────────────

/** "JSS1A" → "A", "SS1 Science" → "Science": what an arm is called within its level. */
const suffix = (armName: string, level: string) => (armName.startsWith(level) ? armName.slice(level.length).trim() : armName).toLowerCase();

/**
 * Everything the promotion screen needs: each class with its students and a
 * suggested destination (the same arm a level up; SS3 graduates).
 */
export async function promotionPlan(scope: TenantScope, actor: Actor) {
  guard(scope, actor);
  const cur = await currentTerm(scope);
  const arms = await scope.query((db, owns) =>
    db
      .select({ id: classArm.id, name: classArm.name, level: classLevel.code, levelId: classLevel.id, sort: classLevel.sortOrder })
      .from(classArm)
      .innerJoin(classLevel, owns(classLevel, eq(classLevel.id, classArm.classLevelId)))
      .where(owns(classArm))
      .orderBy(asc(classLevel.sortOrder), asc(classArm.name)),
  );
  const students = await scope.findMany(student, and(eq(student.status, "active"), sql`${student.classArmId} is not null`)!);
  const levels = [...new Map(arms.map((a) => [a.levelId, { id: a.levelId, code: a.level, sort: a.sort }])).values()].sort((a, b) => a.sort - b.sort);
  const classes = arms.map((a) => {
    const i = levels.findIndex((l) => l.id === a.levelId);
    const next = levels[i + 1];
    let target: Target = { kind: "graduate" };
    let check = false;
    if (next) {
      const options = arms.filter((x) => x.levelId === next.id);
      const same = options.find((x) => suffix(x.name, next.code) === suffix(a.name, a.level));
      const pick = same ?? (options.length === 1 ? options[0] : options[0]);
      target = pick ? { kind: "arm", armId: pick.id } : { kind: "stay" };
      check = !same && options.length > 1;
    }
    const mine = students.filter((s) => s.classArmId === a.id).sort((x, y) => `${x.lastName} ${x.firstName}`.localeCompare(`${y.lastName} ${y.firstName}`));
    return { id: a.id, name: a.name, level: a.level, target, check, students: mine.map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`, admissionNo: s.admissionNo })) };
  });
  const [done] = cur
    ? await scope.query((db) =>
        db
          .select({ at: auditLog.createdAt, who: user.name })
          .from(auditLog)
          .leftJoin(user, eq(user.id, auditLog.actorUserId))
          .where(and(eq(auditLog.schoolId, scope.schoolId), eq(auditLog.action, "students.promote"), sql`${auditLog.meta}->>'sessionId' = ${cur.sessionId}`))
          .orderBy(desc(auditLog.createdAt))
          .limit(1),
      )
    : [];
  return {
    term: cur ? { id: cur.id, number: cur.number, session: cur.sessionName, sessionId: cur.sessionId } : null,
    ready: !!cur && cur.number === 1,
    alreadyPromoted: done ? { at: done.at, who: done.who } : null,
    classes: classes.filter((c) => c.students.length),
    arms: arms.map((a) => ({ id: a.id, name: a.name, level: a.level })),
  };
}

export type PromotionInput = {
  /** By class: where its students go. Classes not listed stay where they are. */
  classes: Record<string, Target>;
  /** By student: overrides their class's destination. */
  students?: Record<string, Target>;
  /** Needed when this session was already promoted once. */
  again?: boolean;
};

/**
 * Moves every class up at the start of a session, in one go: their old class
 * stays on last session's records, SS3 (or whoever is chosen) graduates, and
 * anyone can be kept back or marked as having left.
 */
export async function promoteStudents(scope: TenantScope, actor: Actor, input: PromotionInput, now = new Date()) {
  guard(scope, actor);
  const plan = await promotionPlan(scope, actor);
  if (!plan.term) throw new MoveError("Set up a session and term first.");
  if (!plan.ready) throw new MoveError(`Promotion happens at the start of a new session. In School setup → Session, add the new session and make its 1st term current, then come back here. (The current term is ${["", "1st", "2nd", "3rd"][plan.term.number]} Term ${plan.term.session}.)`);
  if (plan.alreadyPromoted && !input.again) throw new MoveError(`Students were already promoted for ${plan.term.session}. Tick "promote again" if you really mean to move them again.`);
  const armIds = new Set(plan.arms.map((a) => a.id));
  const check = (t: Target) => {
    if (t.kind === "arm" && !armIds.has(t.armId)) throw new MoveError("Choose a class that exists.");
  };
  for (const t of Object.values(input.classes)) check(t);
  for (const t of Object.values(input.students ?? {})) check(t);

  const decisions: { studentId: string; from: string; to: Target }[] = [];
  for (const c of plan.classes) {
    const classTarget = input.classes[c.id] ?? { kind: "stay" as const };
    for (const s of c.students) decisions.push({ studentId: s.id, from: c.id, to: input.students?.[s.id] ?? classTarget });
  }
  const termId = plan.term.id;
  const today = lagosDayKey(now);
  const count = { moved: 0, stayed: 0, graduated: 0, left: 0 };
  await scope.transaction(async (tx) => {
    await recordHistory(tx, decisions.map((d) => d.studentId), { includeCurrent: false, now });
    const staying = decisions.filter((d) => d.to.kind === "arm" || d.to.kind === "stay");
    // Students moving between classes: update in bulk, one statement per destination.
    const byArm = new Map<string, string[]>();
    for (const d of staying) {
      const arm = d.to.kind === "arm" ? d.to.armId : d.from;
      byArm.set(arm, [...(byArm.get(arm) ?? []), d.studentId]);
      if (d.to.kind === "arm" && d.to.armId !== d.from) count.moved++;
      else count.stayed++;
    }
    for (const [arm, ids] of byArm) await tx.update(student, { classArmId: arm }, inArray(student.id, ids));
    await enrolNow(tx, termId, staying.map((d) => ({ studentId: d.studentId, armId: d.to.kind === "arm" ? d.to.armId : d.from })));
    for (const kind of ["graduate", "left"] as const) {
      const ids = decisions.filter((d) => d.to.kind === kind).map((d) => d.studentId);
      if (!ids.length) continue;
      count[kind === "graduate" ? "graduated" : "left"] += ids.length;
      await tx.update(student, { status: kind === "graduate" ? "graduated" : "left", classArmId: null, leftOn: today, leftReason: kind === "graduate" ? "Graduated" : "Left the school" }, inArray(student.id, ids));
      await tx.delete(enrollment, and(eq(enrollment.termId, termId), inArray(enrollment.studentId, ids))!);
      await setSignIn(tx, ids, false, kind === "graduate" ? "Graduated" : "Left the school");
    }
    await tx.query((db) => audit(db, { schoolId: tx.schoolId, actorUserId: actor.id, action: "students.promote", entityType: "session", entityId: plan.term!.sessionId, meta: { sessionId: plan.term!.sessionId, ...count } }));
  });
  return count;
}

// ─── One student at a time ────────────────────────────────────────────────────

async function oneStudent(scope: TenantScope, studentId: string) {
  const s = await scope.findFirst(student, eq(student.id, studentId));
  if (!s) throw new MoveError("Student not found.");
  return s;
}

/** Moves a student to another class from this term on (e.g. a change of arm, or joining mid-year). */
export async function moveStudent(scope: TenantScope, actor: Actor, studentId: string, armId: string, now = new Date()) {
  guard(scope, actor);
  const s = await oneStudent(scope, studentId);
  if (s.status !== "active") throw new MoveError("Readmit the student first.");
  const arm = await scope.findFirst(classArm, eq(classArm.id, armId));
  if (!arm) throw new MoveError("Choose a class.");
  if (s.classArmId === armId) return;
  const cur = await currentTerm(scope);
  await scope.transaction(async (tx) => {
    await recordHistory(tx, [studentId], { includeCurrent: false, now });
    await tx.update(student, { classArmId: armId }, eq(student.id, studentId));
    if (cur) await enrolNow(tx, cur.id, [{ studentId, armId }]);
    await tx.query((db) => audit(db, { schoolId: tx.schoolId, actorUserId: actor.id, action: "students.move", entityType: "student", entityId: studentId, meta: { from: s.classArmId, to: armId } }));
  });
}

/** Graduates a student, or records that they left (transferred out). Their records stay; sign-in stops. */
export async function endStudent(scope: TenantScope, actor: Actor, studentId: string, kind: "graduated" | "left", reason: string, now = new Date()) {
  guard(scope, actor);
  const s = await oneStudent(scope, studentId);
  if (s.status !== "active") throw new MoveError("This student isn't on a class register.");
  const why = reason.trim().slice(0, 200) || (kind === "graduated" ? "Graduated" : "Left the school");
  await scope.transaction(async (tx) => {
    // They were in their class for this term too, so this term's records keep it.
    await recordHistory(tx, [studentId], { includeCurrent: true, now });
    await tx.update(student, { status: kind, classArmId: null, leftOn: lagosDayKey(now), leftReason: why }, eq(student.id, studentId));
    await setSignIn(tx, [studentId], false, why);
    await tx.query((db) => audit(db, { schoolId: tx.schoolId, actorUserId: actor.id, action: kind === "graduated" ? "students.graduate" : "students.leave", entityType: "student", entityId: studentId, meta: { from: s.classArmId, reason: why } }));
  });
}

/** Brings a graduated or departed student back onto a class register. */
export async function readmitStudent(scope: TenantScope, actor: Actor, studentId: string, armId: string) {
  guard(scope, actor);
  const s = await oneStudent(scope, studentId);
  if (s.status === "active") throw new MoveError("This student is already on a class register.");
  const arm = await scope.findFirst(classArm, eq(classArm.id, armId));
  if (!arm) throw new MoveError("Choose a class.");
  const cur = await currentTerm(scope);
  await scope.transaction(async (tx) => {
    await tx.update(student, { status: "active", classArmId: armId, leftOn: null, leftReason: null }, eq(student.id, studentId));
    if (cur) await enrolNow(tx, cur.id, [{ studentId, armId }]);
    await setSignIn(tx, [studentId], true);
    await tx.query((db) => audit(db, { schoolId: tx.schoolId, actorUserId: actor.id, action: "students.readmit", entityType: "student", entityId: studentId, meta: { to: armId } }));
  });
}

