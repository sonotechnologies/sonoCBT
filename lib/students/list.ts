import "server-only";
import { and, asc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { classArm, student, user } from "@/lib/db/schema";
import type { TenantScope } from "@/lib/tenant/scope";

export type StudentListRow = {
  id: string;
  name: string;
  admissionNo: string;
  className: string | null;
  classArmId: string | null;
  gender: string | null;
  guardianPhone: string | null;
  /** Still on the starting password. */
  pendingFirstSignIn: boolean;
  status: "active" | "graduated" | "left";
  leftOn: string | null;
  leftReason: string | null;
};

export async function listStudents(
  scope: TenantScope,
  opts: { classArmIds?: string[] | null; q?: string; limit?: number; status?: "active" | "graduated" | "left" },
): Promise<StudentListRow[]> {
  return scope.query(async (db, owns) => {
    const conds: SQL[] = [eq(student.status, opts.status ?? "active")];
    if (opts.classArmIds) conds.push(inArray(student.classArmId, opts.classArmIds.length ? opts.classArmIds : ["00000000-0000-0000-0000-000000000000"]));
    const q = opts.q?.trim();
    if (q) {
      const like = `%${q.replace(/[%_]/g, "")}%`;
      conds.push(or(ilike(student.firstName, like), ilike(student.lastName, like), ilike(student.admissionNo, like))!);
    }
    const rows = await db
      .select({
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        otherNames: student.otherNames,
        admissionNo: student.admissionNo,
        className: classArm.name,
        classArmId: student.classArmId,
        gender: student.gender,
        guardianPhone: student.guardianPhone,
        mustChangePassword: user.mustChangePassword,
        status: student.status,
        leftOn: student.leftOn,
        leftReason: student.leftReason,
      })
      .from(student)
      .leftJoin(classArm, owns(classArm, eq(classArm.id, student.classArmId)))
      .leftJoin(user, eq(user.id, student.userId))
      .where(owns(student, conds.length ? and(...conds) : undefined))
      .orderBy(asc(classArm.name), asc(student.lastName), asc(student.firstName))
      .limit(opts.limit ?? 500);
    return rows.map((r) => ({
      id: r.id,
      name: [r.lastName, r.firstName, r.otherNames].filter(Boolean).join(" "),
      admissionNo: r.admissionNo,
      className: r.className,
      classArmId: r.classArmId,
      gender: r.gender,
      guardianPhone: r.guardianPhone,
      pendingFirstSignIn: !!r.mustChangePassword,
      status: r.status,
      leftOn: r.leftOn,
      leftReason: r.leftReason,
    }));
  });
}
