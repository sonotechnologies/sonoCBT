/**
 * Phase 10: the demo school is built to the brief, visitors each get their own
 * student, the nightly reset rebuilds only the demo school, and the demo can't
 * pay, email or change passwords.
 */
import { and, count, eq, like } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/permissions";
import { startCheckout } from "@/lib/billing/service";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { startAttempt } from "@/lib/exams/runtime";
import { checkResult } from "@/lib/results/checker";
import { getReportCard } from "@/lib/results/report-card";
import { createSchoolWithAdmin } from "@/lib/school/setup";
import { tenantScope } from "@/lib/tenant/scope";
import { createTestDb } from "@/test/db";
import { seedDemoSchool } from "@/scripts/demo/seed-demo";
import { DEMO_PARENT_CHILD, DEMO_PEOPLE, demoEnabled } from "./config";
import { resetDemoSchool } from "./reset";
import { createDemoVisitor } from "./service";

let db: Db;
let schoolId: string;
let other: string;

const n = async (table: typeof t.student | typeof t.question | typeof t.attempt | typeof t.integrityEvent | typeof t.staffProfile | typeof t.classArm | typeof t.subject, id = schoolId) =>
  (await db.select({ n: count() }).from(table).where(eq(table.schoolId, id)))[0].n;

beforeAll(async () => {
  db = await createTestDb();
  other = (await createSchoolWithAdmin(db, { schoolName: "Real School", adminName: "A", email: "a@real.ng", password: "password-1" })).school.id;
  schoolId = (await seedDemoSchool(db)).schoolId;
});

describe("demo school (Crestview Model College)", () => {
  it("is built to the brief", async () => {
    expect([await n(t.classArm), await n(t.subject), await n(t.student), await n(t.staffProfile)]).toEqual([12, 10, 120, 15]);
    expect(await n(t.question)).toBeGreaterThanOrEqual(600);
    const qs = await db.select().from(t.question).where(eq(t.question.schoolId, schoolId));
    expect(qs.some((q) => JSON.stringify(q.stem).includes("inlineMath"))).toBe(true);
    expect(qs.some((q) => JSON.stringify(q.stem).includes('"image"'))).toBe(true);
    expect(qs.some((q) => q.passageId)).toBe(true);
    const exams = await db.select().from(t.exam).where(eq(t.exam.schoolId, schoolId));
    expect(exams.filter((e) => e.status === "closed")).toHaveLength(3);
    const live = exams.filter((e) => e.status === "scheduled" && e.windowStart < new Date() && e.windowEnd > new Date());
    expect(live).toHaveLength(1);
    expect(await n(t.attempt)).toBeGreaterThan(60);
    expect(await n(t.integrityEvent)).toBeGreaterThan(10);
  });

  it("has last term released with report cards, and PINs that work", async () => {
    const [child] = await db.select().from(t.student).where(and(eq(t.student.schoolId, schoolId), eq(t.student.admissionNo, DEMO_PARENT_CHILD)));
    const [last] = await db.select().from(t.term).where(and(eq(t.term.schoolId, schoolId), eq(t.term.number, 3)));
    const card = await getReportCard(tenantScope(db, schoolId), child.id, last.id);
    expect(card.status).toBe("released");
    if (card.status === "released") expect(card.card).toMatchObject({ classArmName: "JSS3A", released: true, formTeacherRemark: expect.any(String) });
    expect(await checkResult(db, { schoolId, admissionNo: DEMO_PARENT_CHILD, pin: "2504 1336 9087", termId: last.id })).toMatchObject({ ok: true });
  });

  it("gives each visitor their own student, seated for the live exam", async () => {
    const a = await createDemoVisitor(db);
    const b = await createDemoVisitor(db);
    expect(a.admissionNo).not.toBe(b.admissionNo);
    const scope = tenantScope(db, schoolId);
    const [st] = await db.select().from(t.student).where(and(eq(t.student.schoolId, schoolId), eq(t.student.admissionNo, a.admissionNo)));
    const live = (await db.select().from(t.exam).where(and(eq(t.exam.schoolId, schoolId), eq(t.exam.status, "scheduled"))))[0];
    const attempt = await startAttempt(scope, st.id, live.id, { deviceSessionId: "visitor-a" });
    expect(attempt.status).toBe("in_progress");
  });

  it("can't take payments", async () => {
    const [admin] = await db.select().from(t.user).where(eq(t.user.email, DEMO_PEOPLE.admin.email));
    const actor: Actor = { id: admin.id, roles: [{ role: "school_admin", schoolId }] };
    await expect(startCheckout(db, actor, "crestview", schoolId, "premium", DEMO_PEOPLE.admin.email)).rejects.toThrow(/demo school can't make payments/);
  });

  it("the nightly reset rebuilds only the demo school and drops visitors' changes", async () => {
    const before = await n(t.question, other);
    const r = await resetDemoSchool(db);
    schoolId = r.schoolId;
    expect([await n(t.student), await n(t.staffProfile)]).toEqual([120, 15]);
    expect((await db.select({ n: count() }).from(t.student).where(like(t.student.admissionNo, "DEMO/%")))[0].n).toBe(0);
    expect(await n(t.question, other)).toBe(before);
    expect((await db.select().from(t.school).where(eq(t.school.id, other)))).toHaveLength(1);
    // Twice in a row is fine.
    schoolId = (await resetDemoSchool(db)).schoolId;
    expect(await n(t.student)).toBe(120);
  });

  it("one-click sign-in is on in development and needs DEMO_MODE=1 in production", () => {
    const env = process.env as Record<string, string | undefined>;
    const [mode, nodeEnv] = [env.DEMO_MODE, env.NODE_ENV];
    try {
      env.NODE_ENV = "production";
      delete env.DEMO_MODE;
      expect(demoEnabled()).toBe(false);
      env.DEMO_MODE = "1";
      expect(demoEnabled()).toBe(true);
      env.NODE_ENV = "development";
      env.DEMO_MODE = "0";
      expect(demoEnabled()).toBe(false);
    } finally {
      env.DEMO_MODE = mode;
      env.NODE_ENV = nodeEnv;
    }
  });
});
