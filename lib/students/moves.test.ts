/**
 * Moving students between classes: promotion at the start of a session,
 * transfers between arms, graduating and leaving — without rewriting history.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createStudentAccount } from "@/lib/accounts";
import type { Actor } from "@/lib/auth/permissions";
import { billingState } from "@/lib/billing/state";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { classArmForTerm } from "@/lib/results/report-card";
import { createSchoolWithAdmin, saveClassesAndSubjects, saveSessionAndTerms } from "@/lib/school/setup";
import { tenantScope, type TenantScope } from "@/lib/tenant/scope";
import { createTestDb } from "@/test/db";
import { endStudent, moveStudent, promoteStudents, promotionPlan, readmitStudent } from "./moves";

let db: Db;
let scope: TenantScope;
let schoolId: string;
let admin: Actor;
const arm: Record<string, string> = {};
const kid: Record<string, string> = {};
let oldTerm: string;

const COMPONENTS = [
  { name: "CA", weight: 40 },
  { name: "Exam", weight: 60 },
];
const NOW = new Date("2026-10-04T10:00:00Z");

beforeAll(async () => {
  db = await createTestDb();
  const s = await createSchoolWithAdmin(db, { schoolName: "Promo School", adminName: "A", email: "a@promo.ng", password: "password-1" });
  schoolId = s.school.id;
  scope = tenantScope(db, schoolId);
  admin = { id: s.admin.id, roles: [{ role: "school_admin", schoolId }] };
  await saveSessionAndTerms(scope, {
    sessionName: "2025/2026",
    terms: [
      { number: 1, startsOn: "2025-09-15", endsOn: "2025-12-12" },
      { number: 2, startsOn: "2026-01-05", endsOn: "2026-04-02" },
      { number: 3, startsOn: "2026-04-27", endsOn: "2026-07-24" },
    ],
    currentTerm: 3,
    components: COMPONENTS,
  });
  await saveClassesAndSubjects(scope, {
    levels: [
      { code: "JSS1", arms: ["A", "B"] },
      { code: "JSS2", arms: ["A", "B"] },
      { code: "JSS3", arms: ["A"] },
      { code: "SS1", arms: ["Science", "Art"] },
      { code: "SS3", arms: ["A"] },
    ],
    subjects: [{ name: "Mathematics", stage: "all" }],
  });
  for (const a of await scope.findMany(t.classArm)) arm[a.name] = a.id;
  const people: [string, string][] = [
    ["ada", "JSS1A"],
    ["bayo", "JSS1A"],
    ["chika", "JSS1B"],
    ["dayo", "JSS3A"],
    ["efe", "SS3A"],
  ];
  for (const [i, [name, a]] of people.entries()) {
    const { student } = await createStudentAccount(db, { schoolId, admissionNo: `P/${i}`, firstName: name, lastName: "Test", classArmId: arm[a], password: "password-1", mustChangePassword: false });
    kid[name] = student.id;
  }
  oldTerm = (await scope.findFirst(t.term, eq(t.term.isCurrent, true)))!.id;
});

describe("promotion", () => {
  it("suggests the same arm a level up, and graduation for the last level", async () => {
    const plan = await promotionPlan(scope, admin);
    const target = (name: string) => plan.classes.find((c) => c.name === name)!.target;
    expect(target("JSS1A")).toEqual({ kind: "arm", armId: arm.JSS2A });
    expect(target("JSS1B")).toEqual({ kind: "arm", armId: arm.JSS2B });
    // JSS3A has no "A" in SS1: the first SS1 class is suggested and flagged for a check.
    expect(plan.classes.find((c) => c.name === "JSS3A")).toMatchObject({ target: { kind: "arm", armId: arm["SS1 Art"] }, check: true });
    expect(target("SS3A")).toEqual({ kind: "graduate" });
  });

  it("waits for the new session to start", async () => {
    await expect(promoteStudents(scope, admin, { classes: {} }, NOW)).rejects.toThrow(/start of a new session/);
    const teacher: Actor = { id: admin.id, roles: [{ role: "teacher", schoolId }] };
    await expect(promotionPlan(scope, teacher)).rejects.toThrow(/school admin/);
  });

  it("moves everyone up, keeps last session's classes on its records, and graduates SS3", async () => {
    await saveSessionAndTerms(scope, {
      sessionName: "2026/2027",
      terms: [
        { number: 1, startsOn: "2026-09-14", endsOn: "2026-12-18" },
        { number: 2, startsOn: "2027-01-11", endsOn: "2027-04-01" },
        { number: 3, startsOn: "2027-04-26", endsOn: "2027-07-23" },
      ],
      currentTerm: 1,
      components: COMPONENTS,
    });
    const plan = await promotionPlan(scope, admin);
    expect(plan.ready).toBe(true);
    const classes = Object.fromEntries(plan.classes.map((c) => [c.id, c.target]));
    classes[arm.JSS3A] = { kind: "arm", armId: arm["SS1 Science"] };
    const r = await promoteStudents(scope, admin, { classes, students: { [kid.bayo]: { kind: "stay" }, [kid.chika]: { kind: "left" } } }, NOW);
    expect(r).toEqual({ moved: 2, stayed: 1, graduated: 1, left: 1 });

    const now = await scope.findMany(t.student);
    const s = (k: string) => now.find((x) => x.id === kid[k])!;
    expect(s("ada").classArmId).toBe(arm.JSS2A);
    expect(s("bayo").classArmId).toBe(arm.JSS1A);
    expect(s("dayo").classArmId).toBe(arm["SS1 Science"]);
    expect(s("efe")).toMatchObject({ status: "graduated", classArmId: null, leftReason: "Graduated" });
    expect(s("chika")).toMatchObject({ status: "left", classArmId: null });

    // Last session's records keep the old classes; this term has the new ones.
    expect(await classArmForTerm(scope, kid.ada, oldTerm)).toBe(arm.JSS1A);
    expect(await classArmForTerm(scope, kid.efe, oldTerm)).toBe(arm.SS3A);
    const cur = (await scope.findFirst(t.term, eq(t.term.isCurrent, true)))!.id;
    expect(await classArmForTerm(scope, kid.ada, cur)).toBe(arm.JSS2A);
    expect(await scope.findFirst(t.enrollment, and(eq(t.enrollment.studentId, kid.efe), eq(t.enrollment.termId, cur))!)).toBeUndefined();

    // Graduates can't sign in any more.
    const [u] = await db.select().from(t.user).where(eq(t.user.id, s("efe").userId!));
    expect(u).toMatchObject({ banned: true, banReason: "Graduated" });
  });

  it("asks before promoting the same session twice", async () => {
    const plan = await promotionPlan(scope, admin);
    expect(plan.alreadyPromoted).not.toBeNull();
    await expect(promoteStudents(scope, admin, { classes: {} }, NOW)).rejects.toThrow(/already promoted/);
  });
});

describe("one student at a time", () => {
  it("moves a student to another arm from this term on", async () => {
    await moveStudent(scope, admin, kid.ada, arm.JSS2B, NOW);
    const cur = (await scope.findFirst(t.term, eq(t.term.isCurrent, true)))!.id;
    expect(await classArmForTerm(scope, kid.ada, cur)).toBe(arm.JSS2B);
    expect(await classArmForTerm(scope, kid.ada, oldTerm)).toBe(arm.JSS1A);
  });

  it("records leaving, stops sign-in and billing, and can readmit", async () => {
    const before = (await billingState(db, schoolId, NOW)).activeStudents;
    await endStudent(scope, admin, kid.dayo, "left", "Moved to Abuja", NOW);
    const s = (await scope.findFirst(t.student, eq(t.student.id, kid.dayo)))!;
    expect(s).toMatchObject({ status: "left", leftReason: "Moved to Abuja", leftOn: "2026-10-04", classArmId: null });
    expect((await billingState(db, schoolId, NOW)).activeStudents).toBe(before - 1);
    // This term's records still show the class they were in.
    const cur = (await scope.findFirst(t.term, eq(t.term.isCurrent, true)))!.id;
    expect(await classArmForTerm(scope, kid.dayo, cur)).toBe(arm["SS1 Science"]);
    await expect(moveStudent(scope, admin, kid.dayo, arm.JSS2A, NOW)).rejects.toThrow(/Readmit/);

    await readmitStudent(scope, admin, kid.dayo, arm["SS1 Art"]);
    const back = (await scope.findFirst(t.student, eq(t.student.id, kid.dayo)))!;
    expect(back).toMatchObject({ status: "active", classArmId: arm["SS1 Art"], leftOn: null });
    const [u] = await db.select().from(t.user).where(eq(t.user.id, back.userId!));
    expect(u.banned).toBe(false);
    const log = (await scope.findMany(t.auditLog)).map((a) => a.action);
    expect(log).toEqual(expect.arrayContaining(["students.promote", "students.move", "students.leave", "students.readmit"]));
  });
});
