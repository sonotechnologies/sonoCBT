import { hashPassword } from "better-auth/crypto";
import type { Role } from "@/lib/auth/permissions";
import { studentPlaceholderEmail, studentUsername } from "@/lib/auth/student-username";
import type { Db } from "@/lib/db/client";
import { account, staffProfile, student, user, userRole } from "@/lib/db/schema";

type StaffInput = {
  schoolId: string | null;
  name: string;
  email: string;
  password: string;
  /** Pre-hashed password, to skip hashing when creating many accounts with the same one. */
  passwordHash?: string;
  title?: string;
  roles: { role: Role; departmentId?: string; classArmId?: string }[];
};

/** Creates a staff (or platform-owner) login with a credential account and role grants. */
export async function createStaffAccount(db: Db, input: StaffInput) {
  const [u] = await db
    .insert(user)
    .values({ name: input.name, email: input.email.toLowerCase(), emailVerified: true, schoolId: input.schoolId })
    .returning();
  await db.insert(account).values({
    userId: u.id,
    accountId: u.id,
    providerId: "credential",
    password: input.passwordHash ?? (await hashPassword(input.password)),
  });
  if (input.roles.length) {
    await db.insert(userRole).values(input.roles.map((r) => ({ ...r, userId: u.id, schoolId: input.schoolId })));
  }
  if (input.schoolId) {
    await db.insert(staffProfile).values({ schoolId: input.schoolId, userId: u.id, title: input.title });
  }
  return u;
}

type StudentInput = {
  schoolId: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  otherNames?: string;
  gender?: "female" | "male";
  classArmId?: string;
  password: string;
  mustChangePassword?: boolean;
};

/** Creates a student record plus its login (admission number + password, scoped to the school). */
export async function createStudentAccount(db: Db, input: StudentInput) {
  const [u] = await db
    .insert(user)
    .values({
      name: `${input.firstName} ${input.lastName}`,
      email: studentPlaceholderEmail(input.schoolId, input.admissionNo),
      username: studentUsername(input.schoolId, input.admissionNo),
      displayUsername: input.admissionNo,
      schoolId: input.schoolId,
      mustChangePassword: input.mustChangePassword ?? true,
    })
    .returning();
  await db.insert(account).values({
    userId: u.id,
    accountId: u.id,
    providerId: "credential",
    password: await hashPassword(input.password),
  });
  await db.insert(userRole).values({ userId: u.id, schoolId: input.schoolId, role: "student" });
  const [s] = await db
    .insert(student)
    .values({
      schoolId: input.schoolId,
      userId: u.id,
      admissionNo: input.admissionNo,
      firstName: input.firstName,
      lastName: input.lastName,
      otherNames: input.otherNames,
      gender: input.gender,
      classArmId: input.classArmId,
    })
    .returning();
  return { user: u, student: s };
}

/** A SonoCBT platform owner: no school, the platform_owner role, and Better Auth's "admin" role for support sign-in. */
export async function createPlatformOwner(db: Db, input: { name: string; email: string; password: string }) {
  const [u] = await db.insert(user).values({ name: input.name, email: input.email.toLowerCase(), emailVerified: true, schoolId: null, role: "admin" }).returning();
  await db.insert(account).values({ userId: u.id, accountId: u.id, providerId: "credential", password: await hashPassword(input.password) });
  await db.insert(userRole).values({ userId: u.id, role: "platform_owner", schoolId: null });
  return u;
}

/**
 * Many students at once with the same starting password (hashed once), in a
 * few bulk inserts: for the demo school's nightly rebuild.
 */
export async function createStudentsBulk(
  db: Db,
  schoolId: string,
  rows: Omit<StudentInput, "schoolId" | "password">[],
  password: string,
  opts: { mustChangePassword?: boolean } = {},
) {
  if (!rows.length) return [];
  const hash = await hashPassword(password);
  const users = await db
    .insert(user)
    .values(
      rows.map((r) => ({
        name: `${r.firstName} ${r.lastName}`,
        email: studentPlaceholderEmail(schoolId, r.admissionNo),
        username: studentUsername(schoolId, r.admissionNo),
        displayUsername: r.admissionNo,
        schoolId,
        mustChangePassword: opts.mustChangePassword ?? false,
      })),
    )
    .returning();
  await db.insert(account).values(users.map((u) => ({ userId: u.id, accountId: u.id, providerId: "credential", password: hash })));
  await db.insert(userRole).values(users.map((u) => ({ userId: u.id, schoolId, role: "student" as const })));
  return db
    .insert(student)
    .values(rows.map((r, i) => ({ schoolId, userId: users[i].id, admissionNo: r.admissionNo, firstName: r.firstName, lastName: r.lastName, otherNames: r.otherNames, gender: r.gender, classArmId: r.classArmId })))
    .returning();
}
