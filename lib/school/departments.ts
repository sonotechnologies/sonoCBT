import { and, eq, inArray } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { department, subject, user, userRole } from "@/lib/db/schema";
import type { TenantScope } from "@/lib/tenant/scope";
import { SetupError } from "./setup";

export type DepartmentRow = {
  id: string;
  name: string;
  hodUserId: string | null;
  hodName: string | null;
  subjectIds: string[];
};

export async function listDepartments(scope: TenantScope): Promise<DepartmentRow[]> {
  const [depts, subjects] = await Promise.all([scope.findMany(department), scope.findMany(subject)]);
  const hodIds = depts.map((d) => d.hodUserId).filter(Boolean) as string[];
  const names = hodIds.length
    ? await scope.query((db) => db.select({ id: user.id, name: user.name }).from(user).where(and(inArray(user.id, hodIds), eq(user.schoolId, scope.schoolId))))
    : [];
  return depts
    .map((d) => ({
      id: d.id,
      name: d.name,
      hodUserId: d.hodUserId,
      hodName: names.find((n) => n.id === d.hodUserId)?.name ?? null,
      subjectIds: subjects.filter((s) => s.departmentId === d.id).map((s) => s.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Creates or updates a department: its subjects and its head. The head gets an
 * HOD role scoped to this department (and loses it if replaced).
 */
export async function saveDepartment(
  scope: TenantScope,
  actorUserId: string,
  args: { id?: string; name: string; subjectIds: string[]; hodUserId: string | null },
) {
  const name = args.name.trim();
  if (!name) throw new SetupError("Give the department a name.");
  if (args.hodUserId) {
    const [staff] = await scope.query((db) =>
      db.select({ id: user.id }).from(user).where(and(eq(user.id, args.hodUserId!), eq(user.schoolId, scope.schoolId))),
    );
    if (!staff) throw new SetupError("Choose a member of staff as head of department.");
  }

  return scope.transaction(async (tx) => {
    let dept = args.id ? await tx.findFirst(department, eq(department.id, args.id)) : undefined;
    if (args.id && !dept) throw new SetupError("Department not found.");
    const previousHod = dept?.hodUserId ?? null;
    if (dept) [dept] = await tx.update(department, { name, hodUserId: args.hodUserId }, eq(department.id, dept.id));
    else [dept] = await tx.insert(department, { name, hodUserId: args.hodUserId });
    const deptId = dept.id;

    // Subjects: those listed move here; subjects no longer listed are unassigned.
    await tx.update(subject, { departmentId: null }, eq(subject.departmentId, deptId));
    if (args.subjectIds.length) await tx.update(subject, { departmentId: deptId }, inArray(subject.id, args.subjectIds));

    // HOD role grant (user_role is not tenant-scoped by type; schoolId is set explicitly).
    await tx.query(async (db) => {
      if (previousHod && previousHod !== args.hodUserId) {
        await db
          .delete(userRole)
          .where(and(eq(userRole.userId, previousHod), eq(userRole.schoolId, scope.schoolId), eq(userRole.role, "hod"), eq(userRole.departmentId, deptId)));
      }
      if (args.hodUserId) {
        const [has] = await db
          .select({ id: userRole.id })
          .from(userRole)
          .where(and(eq(userRole.userId, args.hodUserId), eq(userRole.schoolId, scope.schoolId), eq(userRole.role, "hod"), eq(userRole.departmentId, deptId)));
        if (!has) await db.insert(userRole).values({ userId: args.hodUserId, schoolId: scope.schoolId, role: "hod", departmentId: deptId });
      }
      await audit(db, { schoolId: scope.schoolId, actorUserId, action: "department.save", entityType: "department", entityId: deptId, meta: { hodUserId: args.hodUserId } });
    });
    return dept;
  });
}

export async function deleteDepartment(scope: TenantScope, actorUserId: string, id: string) {
  await scope.transaction(async (tx) => {
    await tx.update(subject, { departmentId: null }, eq(subject.departmentId, id));
    await tx.query((db) =>
      db.delete(userRole).where(and(eq(userRole.schoolId, scope.schoolId), eq(userRole.role, "hod"), eq(userRole.departmentId, id))),
    );
    await tx.delete(department, eq(department.id, id));
    await tx.query((db) => audit(db, { schoolId: scope.schoolId, actorUserId, action: "department.delete", entityType: "department", entityId: id }));
  });
}

