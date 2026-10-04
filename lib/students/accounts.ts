import { randomInt } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, inArray } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { normaliseAdmissionNo, studentPlaceholderEmail, studentUsername } from "@/lib/auth/student-username";
import type { Db } from "@/lib/db/client";
import { account, classArm, enrollment, session, student, term, user, userRole } from "@/lib/db/schema";
import type { TenantScope } from "@/lib/tenant/scope";

/** No 0/O, 1/l/I: starting passwords are read aloud and copied from paper. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function generateStartingPassword(length = 8): string {
  let s = "";
  for (let i = 0; i < length; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export type NewStudent = {
  firstName: string;
  lastName: string;
  otherNames?: string;
  admissionNo: string;
  classArmId: string;
  gender?: "female" | "male" | "";
  dateOfBirth?: string;
  guardianName?: string;
  guardianPhone?: string;
};

export type StartingLogin = { name: string; admissionNo: string; className: string; password: string };

export type CreateStudentsResult = { created: StartingLogin[]; skipped: { admissionNo: string; reason: string }[] };

/**
 * Creates students with logins and a starting password each (they must change
 * it on first sign-in). Admission numbers already in the school are skipped.
 * The plaintext passwords are returned once, for the admin to hand out; only
 * hashes are stored.
 */
export async function createStudents(
  scope: TenantScope,
  rows: NewStudent[],
  actorUserId: string | null,
): Promise<CreateStudentsResult> {
  const schoolId = scope.schoolId;
  const skipped: CreateStudentsResult["skipped"] = [];

  const arms = new Map((await scope.findMany(classArm)).map((a) => [a.id, a.name]));
  const existing = new Set((await scope.findMany(student)).map((s) => normaliseAdmissionNo(s.admissionNo)));
  const seen = new Set<string>();
  const valid: NewStudent[] = [];
  for (const r of rows) {
    const key = normaliseAdmissionNo(r.admissionNo);
    if (!key) skipped.push({ admissionNo: r.admissionNo, reason: "No admission number" });
    else if (existing.has(key)) skipped.push({ admissionNo: r.admissionNo, reason: "Already in SonoCBT" });
    else if (seen.has(key)) skipped.push({ admissionNo: r.admissionNo, reason: "Duplicate in this list" });
    else if (!arms.has(r.classArmId)) skipped.push({ admissionNo: r.admissionNo, reason: "Class not found" });
    else if (!r.firstName.trim() || !r.lastName.trim()) skipped.push({ admissionNo: r.admissionNo, reason: "Missing name" });
    else {
      seen.add(key);
      valid.push(r);
    }
  }
  if (!valid.length) return { created: [], skipped };

  const passwords = valid.map(() => generateStartingPassword());
  // node:crypto scrypt runs on the libuv pool, so hashing in parallel is much faster.
  const hashes = await Promise.all(passwords.map((p) => hashPassword(p)));
  const currentTerm = await scope.findFirst(term, eq(term.isCurrent, true));

  await scope.transaction(async (tx) => {
    await tx.query(async (db) => {
      const users = await db
        .insert(user)
        .values(
          valid.map((r) => ({
            name: `${r.firstName.trim()} ${r.lastName.trim()}`,
            email: studentPlaceholderEmail(schoolId, r.admissionNo),
            username: studentUsername(schoolId, r.admissionNo),
            displayUsername: r.admissionNo.trim(),
            schoolId,
            mustChangePassword: true,
          })),
        )
        .returning({ id: user.id });
      await db.insert(account).values(
        users.map((u, i) => ({ userId: u.id, accountId: u.id, providerId: "credential", password: hashes[i] })),
      );
      await db.insert(userRole).values(users.map((u) => ({ userId: u.id, schoolId, role: "student" as const })));
      const students = await db
        .insert(student)
        .values(
          valid.map((r, i) => ({
            schoolId,
            userId: users[i].id,
            admissionNo: r.admissionNo.trim(),
            firstName: r.firstName.trim(),
            lastName: r.lastName.trim(),
            otherNames: r.otherNames?.trim() || null,
            gender: r.gender || null,
            dateOfBirth: r.dateOfBirth || null,
            classArmId: r.classArmId,
            guardianName: r.guardianName?.trim() || null,
            guardianPhone: r.guardianPhone?.trim() || null,
          })),
        )
        .returning({ id: student.id });
      if (currentTerm) {
        await db.insert(enrollment).values(
          students.map((s, i) => ({ schoolId, studentId: s.id, termId: currentTerm.id, classArmId: valid[i].classArmId })),
        );
      }
    });
  });

  await scope.query((db) =>
    audit(db, {
      schoolId,
      actorUserId,
      action: "students.import",
      entityType: "student",
      meta: { created: valid.length, skipped: skipped.length },
    }),
  );

  return {
    created: valid.map((r, i) => ({
      name: [r.firstName.trim(), r.otherNames?.trim(), r.lastName.trim()].filter(Boolean).join(" "),
      admissionNo: r.admissionNo.trim(),
      className: arms.get(r.classArmId) ?? "",
      password: passwords[i],
    })),
    skipped,
  };
}

/**
 * Gives a student a new starting password (signed out everywhere; must change
 * it on next sign-in). Returns the plaintext once.
 */
export async function resetStudentPassword(scope: TenantScope, studentId: string, actorUserId: string): Promise<string> {
  const s = await scope.findFirst(student, eq(student.id, studentId));
  if (!s?.userId) throw new Error("Student not found");
  const password = generateStartingPassword();
  const hash = await hashPassword(password);
  const userId = s.userId;
  await scope.query(async (db: Db) => {
    await db.transaction(async (tx) => {
      await tx.update(account).set({ password: hash }).where(and(eq(account.userId, userId), eq(account.providerId, "credential")));
      await tx.update(user).set({ mustChangePassword: true }).where(eq(user.id, userId));
      await tx.delete(session).where(inArray(session.userId, [userId]));
    });
    await audit(db, { schoolId: scope.schoolId, actorUserId, action: "student.passwordReset", entityType: "student", entityId: studentId });
  });
  return password;
}
