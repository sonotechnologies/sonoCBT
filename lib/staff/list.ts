import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { ROLE_LABEL, type Role } from "@/lib/auth/permissions";
import { classArm, staffInvite, subject, subjectOffering, user, userRole } from "@/lib/db/schema";
import type { TenantScope } from "@/lib/tenant/scope";

export type StaffRow = {
  kind: "member" | "invite";
  id: string;
  name: string;
  email: string;
  role: string;
  status: "joined" | "invited" | "not_sent" | "expired";
};

const ROLE_ORDER: Role[] = ["school_admin", "exam_officer", "hod", "form_teacher", "teacher"];

function describe(roles: { role: Role; classArmId?: string | null }[], armName: Map<string, string>, subjects: string[]) {
  const top = ROLE_ORDER.find((r) => roles.some((g) => g.role === r));
  if (!top) return "Staff";
  if (top === "form_teacher") {
    const arm = roles.find((g) => g.role === "form_teacher")?.classArmId;
    return `Form teacher${arm && armName.get(arm) ? ` · ${armName.get(arm)}` : ""}`;
  }
  if (top === "teacher" && subjects.length) {
    return `Teacher · ${subjects.slice(0, 2).join(", ")}${subjects.length > 2 ? ` +${subjects.length - 2}` : ""}`;
  }
  return ROLE_LABEL[top];
}

/** Everyone on the staff list: people who have joined, then pending invites. */
export async function listStaff(scope: TenantScope): Promise<StaffRow[]> {
  return scope.query(async (db, owns) => {
    const [members, grants, invites, arms, subjects, offerings] = await Promise.all([
      db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(eq(user.schoolId, scope.schoolId)),
      db
        .select({ userId: userRole.userId, role: userRole.role, classArmId: userRole.classArmId })
        .from(userRole)
        .where(and(eq(userRole.schoolId, scope.schoolId), ne(userRole.role, "student"))),
      db.select().from(staffInvite).where(owns(staffInvite)),
      db.select({ id: classArm.id, name: classArm.name }).from(classArm).where(owns(classArm)),
      db.select({ id: subject.id, name: subject.name, shortName: subject.shortName }).from(subject).where(owns(subject)),
      db
        .select({ teacherId: subjectOffering.teacherId, subjectId: subjectOffering.subjectId })
        .from(subjectOffering)
        .where(owns(subjectOffering)),
    ]);
    const armName = new Map(arms.map((a) => [a.id, a.name]));
    const subjectName = new Map(subjects.map((s) => [s.id, s.shortName ?? s.name]));
    const staffIds = new Set(grants.map((g) => g.userId));

    const rows: StaffRow[] = members
      .filter((m) => staffIds.has(m.id))
      .map((m) => {
        const taught = [...new Set(offerings.filter((o) => o.teacherId === m.id).map((o) => subjectName.get(o.subjectId)!))];
        return {
          kind: "member" as const,
          id: m.id,
          name: m.name,
          email: m.email,
          role: describe(grants.filter((g) => g.userId === m.id), armName, taught),
          status: "joined" as const,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const now = new Date();
    for (const inv of invites.filter((i) => !i.acceptedAt).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
      rows.push({
        kind: "invite",
        id: inv.id,
        name: inv.name,
        email: inv.email,
        role: describe(inv.roles, armName, inv.subjectIds.map((id) => subjectName.get(id)).filter(Boolean) as string[]),
        status: inv.expiresAt < now ? "expired" : inv.sentAt ? "invited" : "not_sent",
      });
    }
    return rows;
  });
}

/** Subjects and arms for the invite form. */
export async function inviteOptions(scope: TenantScope) {
  return scope.query(async (db, owns) => {
    const [subjects, arms] = await Promise.all([
      db.select({ id: subject.id, name: subject.name }).from(subject).where(owns(subject)).orderBy(subject.sortOrder, subject.name),
      db.select({ id: classArm.id, name: classArm.name }).from(classArm).where(owns(classArm)).orderBy(classArm.name),
    ]);
    return { subjects, arms };
  });
}

