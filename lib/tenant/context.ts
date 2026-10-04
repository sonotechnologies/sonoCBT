import "server-only";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from "@/lib/auth";
import { can, STAFF_ROLES, type Action, type Actor, type Resource, type RoleGrant } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db";
import { school as schoolTable, student as studentTable, userRole } from "@/lib/db/schema";
import { tenantScope, type TenantScope } from "./scope";

export type School = typeof schoolTable.$inferSelect;
export type Student = typeof studentTable.$inferSelect;

export type TenantContext = {
  school: School;
  user: { id: string; name: string; email: string; mustChangePassword: boolean };
  actor: Actor;
  scope: TenantScope;
  isStaff: boolean;
  /** Present when the signed-in user is a student of this school. */
  student: Student | null;
  /** Set when a platform owner is signed in as this user for support. */
  supportBy: string | null;
};

export const getSchoolBySlug = cache(async (slug: string): Promise<School | null> => {
  const [row] = await getDb().select().from(schoolTable).where(eq(schoolTable.slug, slug)).limit(1);
  return row ?? null;
});

/**
 * Resolves the signed-in user's school for a `/s/[schoolSlug]/…` request.
 * The school always comes from the session; the URL slug must agree with it.
 * Returns null when nobody is signed in.
 */
export const getTenantContext = cache(async (schoolSlug: string): Promise<TenantContext | null> => {
  const school = await getSchoolBySlug(schoolSlug);
  if (!school) notFound();

  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;

  const u = session.user as typeof session.user & { schoolId?: string | null; mustChangePassword?: boolean };
  // A user from another school gets the same response as a missing page.
  if (u.schoolId !== school.id) notFound();

  const db = getDb();
  const scope = tenantScope(db, school.id);
  const [grants, student] = await Promise.all([
    db
      .select({
        role: userRole.role,
        schoolId: userRole.schoolId,
        departmentId: userRole.departmentId,
        classArmId: userRole.classArmId,
      })
      .from(userRole)
      .where(and(eq(userRole.userId, u.id), eq(userRole.schoolId, school.id))),
    scope.findFirst(studentTable, eq(studentTable.userId, u.id)),
  ]);

  const roles: RoleGrant[] = grants;
  return {
    school,
    user: { id: u.id, name: u.name, email: u.email, mustChangePassword: !!u.mustChangePassword },
    actor: { id: u.id, roles, studentId: student?.id ?? null },
    scope,
    isStaff: roles.some((g) => STAFF_ROLES.has(g.role)),
    student: student ?? null,
    supportBy: (session.session as { impersonatedBy?: string | null }).impersonatedBy ?? null,
  };
});

export async function requireStaff(schoolSlug: string): Promise<TenantContext> {
  const ctx = await getTenantContext(schoolSlug);
  if (!ctx) redirect("/login");
  if (!ctx.isStaff) redirect(`/s/${schoolSlug}/student`);
  if (ctx.school.status === "suspended" && !ctx.supportBy) redirect(`/suspended?school=${schoolSlug}`);
  return ctx;
}

export async function requireStudent(schoolSlug: string): Promise<TenantContext & { student: Student }> {
  const ctx = await getTenantContext(schoolSlug);
  if (!ctx) redirect(`/s/${schoolSlug}/login`);
  if (!ctx.student) redirect(`/s/${schoolSlug}/dashboard`);
  if (ctx.school.status === "suspended") redirect(`/suspended?school=${schoolSlug}`);
  if (ctx.user.mustChangePassword) redirect(`/s/${schoolSlug}/change-password`);
  return ctx as TenantContext & { student: Student };
}

/** Staff page/action guard: the signed-in staff member must be allowed `action` in this school. */
export async function requireCan(
  schoolSlug: string,
  action: Action,
  resource?: Omit<Resource, "schoolId">,
): Promise<TenantContext> {
  const ctx = await requireStaff(schoolSlug);
  if (!can(ctx.actor, action, { ...resource, schoolId: ctx.school.id })) notFound();
  return ctx;
}
