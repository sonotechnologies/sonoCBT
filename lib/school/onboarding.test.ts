/**
 * Phase 1 acceptance: a new school goes from signup to 100 students and staff.
 * (The "under 10 minutes" is a UX target; this proves the server side does the
 * whole journey correctly and quickly.)
 */
import { count, eq, isNotNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createAuth, type Auth } from "@/lib/auth/auth";
import { studentUsername } from "@/lib/auth/student-username";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { checkStudents, isImportable, readStudentSheet } from "@/lib/import/students";
import { createStudents, resetStudentPassword } from "@/lib/students/accounts";
import { acceptInvite, findInvite, InviteError, inviteStaff, revokeInvite } from "@/lib/staff/invites";
import { tenantScope } from "@/lib/tenant/scope";
import { createTestDb } from "@/test/db";
import { seedSchoolFixture } from "@/test/fixtures";
import { DEFAULT_ARMS, DEFAULT_SUBJECTS, defaultTerms } from "./defaults";
import {
  armsOf,
  createSchoolWithAdmin,
  saveBranding,
  saveClassesAndSubjects,
  saveSchoolDetails,
  saveSessionAndTerms,
  SetupError,
  slugify,
  validateSession,
} from "./setup";

let db: Db;
let auth: Auth;

beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-1234";
  process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
  db = await createTestDb();
  auth = createAuth(db);
});

const FIRST = ["Chiamaka", "Tunde", "Aisha", "Emeka", "Ngozi", "Ibrahim", "Funke", "Segun", "Halima", "Uche"];
const LAST = ["Okafor", "Bakare", "Mohammed", "Nwosu", "Eze", "Sani", "Akinola", "Oladipo", "Garba", "Ibe"];

describe("signup → 100 students and staff", () => {
  it("runs the whole onboarding", async () => {
    const started = Date.now();

    // 1. Signup
    const { school, admin } = await createSchoolWithAdmin(db, {
      schoolName: "Bright Future College, Ikeja",
      adminName: "Mrs. Adunni Ogundipe",
      email: "proprietor@brightfuture.ng",
      password: "a-strong-password",
    });
    expect(school.slug).toBe("bright-future-college-ikeja");
    expect(school.status).toBe("trial");
    const scope = tenantScope(db, school.id);

    // 2. Details, branding, session & terms
    await saveSchoolDetails(db, school.id, {
      name: "Bright Future College",
      address: "3 Allen Avenue",
      locality: "Ikeja",
      state: "Lagos",
      phone: "0803 000 0000",
      email: "INFO@brightfuture.ng",
      principalName: "Mr. Kunle Ade",
    });
    await saveBranding(db, school.id, { motto: "Light and Learning", brandColor: "#7a1f2b" });
    await saveSessionAndTerms(scope, {
      sessionName: "2026/2027",
      terms: defaultTerms(2026),
      currentTerm: 1,
      components: [
        { name: "CA", weight: 40 },
        { name: "Exam", weight: 60 },
      ],
    });

    // 3. Classes & subjects (defaults: 6 levels, 15 arms)
    await saveClassesAndSubjects(scope, {
      levels: Object.entries(DEFAULT_ARMS).map(([code, arms]) => ({ code, arms })),
      subjects: DEFAULT_SUBJECTS,
    });
    const arms = await armsOf(scope);
    expect(arms.map((a) => a.name)).toContain("JSS1A");
    expect(arms.map((a) => a.name)).toContain("SS2 Commercial");
    expect(arms).toHaveLength(15);

    // 4. Invite staff and they accept
    const subjects = await scope.findMany(t.subject);
    const maths = subjects.find((s) => s.name === "Mathematics")!;
    const jss1a = arms.find((a) => a.name === "JSS1A")!;
    const invites = [
      { name: "Mrs. Funmilayo Adebayo", email: "f.adebayo@brightfuture.ng", role: "exam_officer" as const },
      { name: "Mallam Ibrahim Sani", email: "i.sani@brightfuture.ng", role: "teacher" as const, subjectIds: [maths.id] },
      { name: "Miss Blessing Etim", email: "b.etim@brightfuture.ng", role: "form_teacher" as const, classArmId: jss1a.id },
      { name: "Mr. Emeka Nwosu", email: "e.nwosu@brightfuture.ng", role: "teacher" as const },
      { name: "Mr. Kunle Ade", email: "k.ade@brightfuture.ng", role: "school_admin" as const },
    ];
    for (const inv of invites) {
      const { token, sent } = await inviteStaff(scope, inv, admin.id);
      expect(sent).toBe(true); // logged in dev (no RESEND_API_KEY)
      await acceptInvite(db, token, "teacher-password");
    }

    // 5. Import 100 students from a class list
    const sheet: unknown[][] = [["S/N", "Name", "Adm No", "Class", "Sex"]];
    for (let i = 0; i < 100; i++) {
      sheet.push([
        i + 1,
        `${LAST[i % 10].toUpperCase()} ${FIRST[(i * 3) % 10]}`,
        `BFC/2026/${String(i + 1).padStart(4, "0")}`,
        arms[i % arms.length].name,
        i % 2 ? "M" : "F",
      ]);
    }
    const { rows, missingColumns } = readStudentSheet(sheet);
    expect(missingColumns).toEqual([]);
    const checked = checkStudents(rows, { arms, existingAdmissionNos: new Set() });
    expect(checked.every(isImportable)).toBe(true);
    const { created, skipped } = await createStudents(
      scope,
      checked.map((r) => ({ ...r, classArmId: r.classArmId! })),
      admin.id,
    );
    expect(created).toHaveLength(100);
    expect(skipped).toHaveLength(0);

    const elapsed = Date.now() - started;
    console.info(`signup → 100 students + 5 staff: ${elapsed} ms`);
    expect(elapsed).toBeLessThan(60_000);

    // Everyone is there
    const [{ n: students }] = await db.select({ n: count() }).from(t.student).where(eq(t.student.schoolId, school.id));
    const staffRoles = await db.select().from(t.userRole).where(eq(t.userRole.schoolId, school.id));
    expect(students).toBe(100);
    expect(new Set(staffRoles.filter((r) => r.role !== "student").map((r) => r.userId)).size).toBe(6);
    const [{ n: enrolled }] = await db.select({ n: count() }).from(t.enrollment).where(eq(t.enrollment.schoolId, school.id));
    expect(enrolled).toBe(100);

    // Imported students sign in with their starting password and must change it
    const first = created[0];
    const res = await auth.api.signInUsername({
      body: { username: studentUsername(school.id, first.admissionNo), password: first.password },
    });
    expect((res?.user as { mustChangePassword?: boolean }).mustChangePassword).toBe(true);

    // Staff sign in with the password they chose
    const staff = await auth.api.signInEmail({ body: { email: "i.sani@brightfuture.ng", password: "teacher-password" } });
    expect((staff.user as { schoolId?: string }).schoolId).toBe(school.id);

    // The maths teacher got every maths class; the form teacher got JSS1A
    const mathsOfferings = await scope.findMany(t.subjectOffering, eq(t.subjectOffering.subjectId, maths.id));
    expect(mathsOfferings.length).toBe(15);
    expect(mathsOfferings.every((o) => o.teacherId === staff.user.id)).toBe(true);
    const arm = await scope.findFirst(t.classArm, eq(t.classArm.id, jss1a.id));
    expect(arm?.formTeacherId).not.toBeNull();

    // Every invite is marked accepted
    const accepted = await scope.findMany(t.staffInvite, isNotNull(t.staffInvite.acceptedAt));
    expect(accepted).toHaveLength(5);
  });
});

describe("setup rules", () => {
  it("makes URL-safe, unique slugs", async () => {
    expect(slugify("St. Mary's College, Ọ̀yọ́ & Co")).toBe("st-mary-s-college-oyo-and-co");
    const a = await createSchoolWithAdmin(db, { schoolName: "Twin School", adminName: "A", email: "a@twin.ng", password: "password-1" });
    const b = await createSchoolWithAdmin(db, { schoolName: "Twin School", adminName: "B", email: "b@twin.ng", password: "password-1" });
    expect(a.school.slug).toBe("twin-school");
    expect(b.school.slug).toBe("twin-school-2");
  });

  it("refuses a second account for the same email", async () => {
    await expect(
      createSchoolWithAdmin(db, { schoolName: "X", adminName: "X", email: "A@twin.ng", password: "password-1" }),
    ).rejects.toBeInstanceOf(SetupError);
  });

  it("validates sessions and weights", () => {
    const ok = { sessionName: "2026/2027", terms: defaultTerms(2026), currentTerm: 1, components: [{ name: "CA", weight: 40 }, { name: "Exam", weight: 60 }] };
    expect(validateSession(ok)).toBeNull();
    expect(validateSession({ ...ok, sessionName: "2026-27" })).toMatch(/2026\/2027/);
    expect(validateSession({ ...ok, components: [{ name: "CA", weight: 30 }, { name: "Exam", weight: 60 }] })).toMatch(/add up to 90/);
    expect(validateSession({ ...ok, terms: [{ number: 1, startsOn: "2026-09-14", endsOn: "2026-12-18" }, { number: 2, startsOn: "2026-12-01", endsOn: "2027-04-01" }] })).toMatch(/overlap/);
  });

  it("never deletes a class that has students", async () => {
    const { school, admin } = await createSchoolWithAdmin(db, { schoolName: "Keep Classes", adminName: "K", email: "k@keep.ng", password: "password-1" });
    const scope = tenantScope(db, school.id);
    await saveClassesAndSubjects(scope, { levels: [{ code: "JSS1", arms: ["A", "B"] }], subjects: [{ name: "Mathematics", stage: "all" }] });
    const [a] = (await armsOf(scope)).filter((x) => x.name === "JSS1B");
    await createStudents(scope, [{ firstName: "Ada", lastName: "Obi", admissionNo: "K/1", classArmId: a.id }], admin.id);
    const res = await saveClassesAndSubjects(scope, { levels: [{ code: "JSS1", arms: ["A"] }], subjects: [{ name: "Mathematics", stage: "all" }] });
    expect(res.kept).toEqual(["JSS1B"]);
    expect((await armsOf(scope)).map((x) => x.name).sort()).toEqual(["JSS1A", "JSS1B"]);
  });

  it("gives JSS arms JSS subjects and SS arms SS subjects", async () => {
    const { school } = await createSchoolWithAdmin(db, { schoolName: "Stages", adminName: "S", email: "s@stages.ng", password: "password-1" });
    const scope = tenantScope(db, school.id);
    await saveClassesAndSubjects(scope, {
      levels: [{ code: "JSS1", arms: ["A"] }, { code: "SS1", arms: ["Science"] }],
      subjects: [{ name: "English Language", stage: "all" }, { name: "Basic Science", stage: "jss" }, { name: "Physics", stage: "ss" }],
    });
    const rows = await scope.query((d, owns) =>
      d
        .select({ arm: t.classArm.name, subject: t.subject.name })
        .from(t.subjectOffering)
        .innerJoin(t.classArm, owns(t.classArm, eq(t.classArm.id, t.subjectOffering.classArmId)))
        .innerJoin(t.subject, owns(t.subject, eq(t.subject.id, t.subjectOffering.subjectId)))
        .where(owns(t.subjectOffering)),
    );
    const pairs = rows.map((r) => `${r.arm}:${r.subject}`).sort();
    expect(pairs).toEqual(["JSS1A:Basic Science", "JSS1A:English Language", "SS1 Science:English Language", "SS1 Science:Physics"]);
  });
});

describe("saving twice", () => {
  it("is idempotent and keeps subject ids across case changes", async () => {
    const { school } = await createSchoolWithAdmin(db, { schoolName: "Twice", adminName: "T", email: "t@twice.ng", password: "password-1" });
    const scope = tenantScope(db, school.id);
    const session = { sessionName: "2026/2027", terms: defaultTerms(2026), currentTerm: 1, components: [{ name: "CA", weight: 40 }, { name: "Exam", weight: 60 }] };
    await saveSessionAndTerms(scope, session);
    await saveSessionAndTerms(scope, { ...session, currentTerm: 2, components: [{ name: "CA1", weight: 20 }, { name: "CA2", weight: 20 }, { name: "Exam", weight: 60 }] });
    const terms = await scope.findMany(t.term);
    expect(terms).toHaveLength(3);
    expect(terms.filter((x) => x.isCurrent).map((x) => x.number)).toEqual([2]);
    const comps = await scope.findMany(t.assessmentComponent);
    expect(comps.filter((c) => c.termId === terms[0].id).map((c) => c.name).sort()).toEqual(["CA1", "CA2", "Exam"]);
    expect(await scope.findMany(t.gradingScale)).toHaveLength(1);

    const classes = { levels: [{ code: "JSS1", arms: ["A", "B"] }], subjects: [{ name: "Mathematics", stage: "all" as const }] };
    await saveClassesAndSubjects(scope, classes);
    const [maths] = await scope.findMany(t.subject);
    await saveClassesAndSubjects(scope, { ...classes, subjects: [{ name: "mathematics", stage: "all" }] });
    const subjects = await scope.findMany(t.subject);
    expect(subjects.map((s) => s.id)).toEqual([maths.id]);
    expect(await scope.findMany(t.classArm)).toHaveLength(2);
    expect(await scope.findMany(t.subjectOffering)).toHaveLength(2);
  });
});

describe("invites", () => {
  it("are single-use, expire, and can be revoked", async () => {
    const { school, admin } = await createSchoolWithAdmin(db, { schoolName: "Invites", adminName: "I", email: "i@inv.ng", password: "password-1" });
    const scope = tenantScope(db, school.id);
    const { token } = await inviteStaff(scope, { name: "T One", email: "t1@inv.ng", role: "teacher" }, admin.id);
    await acceptInvite(db, token, "password-1");
    await expect(acceptInvite(db, token, "password-1")).rejects.toBeInstanceOf(InviteError);

    const second = await inviteStaff(scope, { name: "T Two", email: "t2@inv.ng", role: "teacher" }, admin.id);
    await scope.update(t.staffInvite, { expiresAt: new Date(Date.now() - 1000) }, eq(t.staffInvite.id, second.invite.id));
    expect(await findInvite(db, second.token)).toBeNull();

    const third = await inviteStaff(scope, { name: "T Three", email: "t3@inv.ng", role: "teacher" }, admin.id);
    await revokeInvite(scope, third.invite.id, admin.id);
    expect(await findInvite(db, third.token)).toBeNull();
  });

  it("re-inviting the same email replaces the old link", async () => {
    const { school, admin } = await createSchoolWithAdmin(db, { schoolName: "Reinvite", adminName: "R", email: "r@re.ng", password: "password-1" });
    const scope = tenantScope(db, school.id);
    const first = await inviteStaff(scope, { name: "T", email: "t@re.ng", role: "teacher" }, admin.id);
    const second = await inviteStaff(scope, { name: "T", email: "t@re.ng", role: "teacher" }, admin.id);
    expect(second.invite.id).toBe(first.invite.id);
    expect(await findInvite(db, first.token)).toBeNull();
    expect(await findInvite(db, second.token)).not.toBeNull();
  });

  it("refuses an email that already has an account", async () => {
    const { school, admin } = await createSchoolWithAdmin(db, { schoolName: "Taken", adminName: "T", email: "t@taken.ng", password: "password-1" });
    await expect(
      inviteStaff(tenantScope(db, school.id), { name: "Me", email: "t@taken.ng", role: "teacher" }, admin.id),
    ).rejects.toThrow(/already has/);
  });

  it("cannot assign a form teacher to another school's class", async () => {
    const other = await seedSchoolFixture(db, "other");
    const { school, admin } = await createSchoolWithAdmin(db, { schoolName: "Cross", adminName: "C", email: "c@cross.ng", password: "password-1" });
    await expect(
      inviteStaff(tenantScope(db, school.id), { name: "F", email: "f@cross.ng", role: "form_teacher", classArmId: other.ids.classArm }, admin.id),
    ).rejects.toThrow(/Choose the class/);
  });
});

describe("student passwords", () => {
  it("reset gives a new starting password and signs the student out", async () => {
    const { school, admin } = await createSchoolWithAdmin(db, { schoolName: "Resets", adminName: "R", email: "r@resets.ng", password: "password-1" });
    const scope = tenantScope(db, school.id);
    await saveClassesAndSubjects(scope, { levels: [{ code: "JSS1", arms: ["A"] }], subjects: [{ name: "Mathematics", stage: "all" }] });
    const [arm] = await armsOf(scope);
    const { created } = await createStudents(scope, [{ firstName: "Ada", lastName: "Obi", admissionNo: "R/1", classArmId: arm.id }], admin.id);
    const username = studentUsername(school.id, "R/1");
    await auth.api.signInUsername({ body: { username, password: created[0].password } });

    const [s] = await scope.findMany(t.student);
    const fresh = await resetStudentPassword(scope, s.id, admin.id);
    expect(fresh).toMatch(/^[a-hj-km-np-z2-9]{8}$/);
    const sessions = await db.select().from(t.session).where(eq(t.session.userId, s.userId!));
    expect(sessions).toHaveLength(0);
    await expect(auth.api.signInUsername({ body: { username, password: created[0].password } })).rejects.toThrow();
    const ok = await auth.api.signInUsername({ body: { username, password: fresh } });
    expect(ok?.user.id).toBe(s.userId);
  });

  it("cannot reset another school's student", async () => {
    const other = await seedSchoolFixture(db, "other2");
    const { school, admin } = await createSchoolWithAdmin(db, { schoolName: "NoCross", adminName: "N", email: "n@nocross.ng", password: "password-1" });
    await expect(resetStudentPassword(tenantScope(db, school.id), other.student.id, admin.id)).rejects.toThrow();
  });

  it("import skips admission numbers already in the school", async () => {
    const { school, admin } = await createSchoolWithAdmin(db, { schoolName: "Dupes", adminName: "D", email: "d@dupes.ng", password: "password-1" });
    const scope = tenantScope(db, school.id);
    await saveClassesAndSubjects(scope, { levels: [{ code: "JSS1", arms: ["A"] }], subjects: [{ name: "Mathematics", stage: "all" }] });
    const [arm] = await armsOf(scope);
    const row = { firstName: "Ada", lastName: "Obi", admissionNo: "D/1", classArmId: arm.id };
    await createStudents(scope, [row], admin.id);
    const again = await createStudents(scope, [row, { ...row, admissionNo: "d/1 " }], admin.id);
    expect(again.created).toHaveLength(0);
    expect(again.skipped.map((s) => s.reason)).toEqual(["Already in SonoCBT", "Already in SonoCBT"]);
  });
});


