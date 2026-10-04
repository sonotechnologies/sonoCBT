import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { can, type Actor } from "@/lib/auth/permissions";
import { billingState } from "@/lib/billing/state";
import type { Db } from "@/lib/db/client";
import { auditLog, school, session, student, subscription, user, userRole } from "@/lib/db/schema";

export class PlatformError extends Error {}

function guard(actor: Actor) {
  if (!can(actor, "platform.manage", { schoolId: "" })) throw new PlatformError("Platform owners only.");
}

/** Every school with its billing status, plan, students, staff and when someone last signed in. */
export async function listSchools(db: Db, actor: Actor, now = new Date()) {
  guard(actor);
  const schools = await db.select().from(school).orderBy(asc(school.name));
  const ids = schools.map((s) => s.id);
  if (!ids.length) return [];
  const [students, staff, active, paid] = await Promise.all([
    db.select({ schoolId: student.schoolId, n: sql<number>`count(*)::int` }).from(student).where(and(inArray(student.schoolId, ids), isNotNull(student.classArmId))).groupBy(student.schoolId),
    db.select({ schoolId: userRole.schoolId, n: sql<number>`count(distinct ${userRole.userId})::int` }).from(userRole).where(and(inArray(userRole.schoolId, ids), sql`${userRole.role} <> 'student'`)).groupBy(userRole.schoolId),
    db
      .select({ schoolId: user.schoolId, at: sql<Date>`max(${session.updatedAt})` })
      .from(session)
      .innerJoin(user, eq(user.id, session.userId))
      .where(and(inArray(user.schoolId, ids), sql`${session.impersonatedBy} is null`))
      .groupBy(user.schoolId),
    db.select({ schoolId: subscription.schoolId, total: sql<number>`coalesce(sum(${subscription.amount}), 0)::int` }).from(subscription).where(and(inArray(subscription.schoolId, ids), eq(subscription.status, "paid"))).groupBy(subscription.schoolId),
  ]);
  return Promise.all(
    schools.map(async (s) => {
      const b = await billingState(db, s.id, now);
      const at = active.find((a) => a.schoolId === s.id)?.at;
      return {
        id: s.id,
        name: s.name,
        slug: s.slug,
        locality: s.locality,
        isDemo: s.isDemo,
        status: b.status,
        plan: b.plan,
        paidPlan: b.paidPlan,
        trialEndsAt: b.trialEndsAt,
        students: students.find((x) => x.schoolId === s.id)?.n ?? 0,
        staff: staff.find((x) => x.schoolId === s.id)?.n ?? 0,
        lastActive: at ? new Date(at) : null,
        paidTotal: paid.find((p) => p.schoolId === s.id)?.total ?? 0,
        createdAt: s.createdAt,
      };
    }),
  );
}

export async function schoolDetail(db: Db, actor: Actor, schoolId: string) {
  guard(actor);
  const [s] = await db.select().from(school).where(eq(school.id, schoolId));
  if (!s) throw new PlatformError("School not found.");
  const [admins, log] = await Promise.all([
    db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(userRole)
      .innerJoin(user, eq(user.id, userRole.userId))
      .where(and(eq(userRole.schoolId, schoolId), eq(userRole.role, "school_admin")))
      .orderBy(asc(user.name)),
    db
      .select({ at: auditLog.createdAt, action: auditLog.action, meta: auditLog.meta, who: user.name })
      .from(auditLog)
      .leftJoin(user, eq(user.id, auditLog.actorUserId))
      .where(and(eq(auditLog.schoolId, schoolId), sql`${auditLog.action} like 'platform.%' or ${auditLog.action} like 'billing.%'`))
      .orderBy(desc(auditLog.createdAt))
      .limit(30),
  ]);
  return { school: s, admins, log: log.filter((l) => l.action.startsWith("platform.") || l.action.startsWith("billing.")) };
}

/** Suspend (staff and students can't sign in; data kept) or reactivate a school. Always audited. */
export async function setSuspended(db: Db, actor: Actor, schoolId: string, suspended: boolean, reason: string) {
  guard(actor);
  if (suspended && reason.trim().length < 3) throw new PlatformError("Give a reason for suspending (it goes in the log).");
  const [s] = await db.select().from(school).where(eq(school.id, schoolId));
  if (!s) throw new PlatformError("School not found.");
  if (s.isDemo && suspended) throw new PlatformError("The demo school can't be suspended.");
  // Reactivating returns to what billing says; "active" is a safe stored value as billing state is worked out live.
  await db.update(school).set({ status: suspended ? "suspended" : "active" }).where(eq(school.id, schoolId));
  await audit(db, { schoolId, actorUserId: actor.id, action: suspended ? "platform.suspend" : "platform.reactivate", entityType: "school", entityId: schoolId, meta: reason.trim() ? { reason: reason.trim() } : {} });
}

/** Whom a support sign-in becomes: the school's first admin. */
export async function supportTarget(db: Db, actor: Actor, schoolId: string) {
  if (!can(actor, "platform.impersonate", { schoolId: "" })) throw new PlatformError("Platform owners only.");
  const { admins, school: s } = await schoolDetail(db, actor, schoolId);
  if (!admins.length) throw new PlatformError("This school has no admin to sign in as.");
  return { userId: admins[0].id, name: admins[0].name, slug: s.slug };
}
