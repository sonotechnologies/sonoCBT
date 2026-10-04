/**
 * Phase 7: report-card extras (who writes what, and when), result-PIN batches
 * and the public verify page, against the demo seed.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/permissions";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { tenantScope, type TenantScope } from "@/lib/tenant/scope";
import { createTestDb } from "@/test/db";
import { seedGreenfield } from "@/scripts/seed";
import { checkResult } from "./checker";
import { classExtras, fillPrincipalRemarks, saveExtras, setDaysOpened } from "./extras";
import { suggestPrincipalRemark } from "./extras-model";
import { checkPinsForSheet, generatePinBatch, pinBatches, pinUsage } from "./pins";
import { changeLog, moveBatches } from "./pipeline";
import { getReportCard } from "./report-card";
import { normaliseCode, verifyReportCard } from "./verify";

let db: Db;
let scope: TenantScope;
let schoolId: string;
let admin: Actor;
let officer: Actor;
let musa: Actor;
let nowTerm: string;
let lastTerm: string;
let jss3b: string;
let jss2b: string;
let kids: { id: string; admissionNo: string }[];

async function actor(email: string): Promise<Actor> {
  const [u] = await db.select().from(t.user).where(eq(t.user.email, email));
  const roles = await db.select({ role: t.userRole.role, schoolId: t.userRole.schoolId, departmentId: t.userRole.departmentId, classArmId: t.userRole.classArmId }).from(t.userRole).where(eq(t.userRole.userId, u.id));
  return { id: u.id, roles };
}

beforeAll(async () => {
  db = await createTestDb();
  const { school } = await seedGreenfield(db);
  schoolId = school.id;
  scope = tenantScope(db, school.id);
  [admin, officer, musa] = await Promise.all([actor("proprietor@greenfieldacademy.ng"), actor("f.adebayo@greenfieldacademy.ng"), actor("i.musa@greenfieldacademy.ng")]);
  const terms = await scope.findMany(t.term);
  nowTerm = terms.find((x) => x.isCurrent)!.id;
  const s2526 = (await scope.findMany(t.academicSession)).find((s) => s.name === "2025/2026")!.id;
  lastTerm = terms.find((x) => x.sessionId === s2526 && x.number === 3)!.id;
  const arms = await scope.findMany(t.classArm);
  jss3b = arms.find((a) => a.name === "JSS3B")!.id;
  jss2b = arms.find((a) => a.name === "JSS2B")!.id;
  kids = (await scope.findMany(t.student, eq(t.student.classArmId, jss3b))).sort((a, b) => a.admissionNo.localeCompare(b.admissionNo));
});

describe("report-card extras", () => {
  it("lets the form teacher fill in remarks, ratings and attendance for their class only", async () => {
    await saveExtras(scope, musa, nowTerm, jss3b, kids[1].id, {
      formTeacherRemark: "  Works hard.  ",
      affective: { punctuality: 5, honesty: 4 },
      psychomotor: { handwriting: 3 },
      daysPresent: 40,
      daysOpened: 44,
    });
    const data = await classExtras(scope, musa, nowTerm, jss3b);
    expect(data.access).toMatchObject({ edit: true, principal: false });
    expect(data.students.find((s) => s.id === kids[1].id)!.extras).toMatchObject({ formTeacherRemark: "Works hard.", affective: { punctuality: 5, honesty: 4 }, daysPresent: 40, daysOpened: 44 });
    await expect(classExtras(scope, musa, nowTerm, jss2b)).rejects.toThrow(/not found/);
    await expect(saveExtras(scope, musa, nowTerm, jss3b, kids[1].id, { principalRemark: "Good." })).rejects.toThrow(/school admin/);
  });

  it("checks ratings and attendance", async () => {
    await expect(saveExtras(scope, musa, nowTerm, jss3b, kids[1].id, { affective: { punctuality: 6 } })).rejects.toThrow(/1 to 5/);
    await expect(saveExtras(scope, musa, nowTerm, jss3b, kids[1].id, { affective: { charm: 4 } })).rejects.toThrow(/unknown rating/);
    await expect(saveExtras(scope, musa, nowTerm, jss3b, kids[1].id, { daysPresent: 50 })).rejects.toThrow(/more than the days school opened/);
    await expect(setDaysOpened(scope, musa, nowTerm, jss3b, 39)).rejects.toThrow(/present 40 days/);
    expect(await setDaysOpened(scope, musa, nowTerm, jss3b, 45)).toEqual({ updated: kids.length });
    const data = await classExtras(scope, musa, nowTerm, jss3b);
    expect(data.students.every((s) => s.extras.daysOpened === 45)).toBe(true);
  });

  it("fills the principal's remark from each average, keeping any already written", async () => {
    await saveExtras(scope, admin, nowTerm, jss3b, kids[0].id, { principalRemark: "Written by hand." });
    const { filled } = await fillPrincipalRemarks(scope, admin, nowTerm, jss3b);
    expect(filled).toBe(kids.length - 1);
    const data = await classExtras(scope, admin, nowTerm, jss3b);
    expect(data.students.find((s) => s.id === kids[0].id)!.extras.principalRemark).toBe("Written by hand.");
    const other = data.students.find((s) => s.id === kids[2].id)!;
    expect(other.extras.principalRemark).toBe(suggestPrincipalRemark(other.average!));
    await expect(fillPrincipalRemarks(scope, musa, nowTerm, jss3b)).rejects.toThrow(/school admin/);
  });

  it("locks for the form teacher once approved; admin changes after release are logged", async () => {
    await moveBatches(scope, musa, nowTerm, [jss3b], "submit");
    await moveBatches(scope, officer, nowTerm, [jss3b], "approve");
    await expect(saveExtras(scope, musa, nowTerm, jss3b, kids[1].id, { formTeacherRemark: "Late change" })).rejects.toThrow(/approved/);
    await moveBatches(scope, admin, nowTerm, [jss3b], "release");
    await saveExtras(scope, admin, nowTerm, jss3b, kids[1].id, { formTeacherRemark: "Corrected remark." });
    const log = await changeLog(scope, nowTerm, jss3b);
    expect(log[0].what).toBe("Changed a report card (form teacher's remark)");
  });
});

describe("result PINs", () => {
  let made: Awaited<ReturnType<typeof generatePinBatch>>;

  it("only the admin makes them; serials continue the school's numbering and only hashes are kept", async () => {
    await expect(generatePinBatch(scope, officer, { termId: lastTerm, count: 5, maxUses: 3 })).rejects.toThrow(/school admin/);
    await expect(generatePinBatch(scope, admin, { termId: lastTerm, count: 0, maxUses: 3 })).rejects.toThrow(/between 1 and 500/);
    made = await generatePinBatch(scope, admin, { termId: lastTerm, count: 25, maxUses: 3 }, new Date("2026-10-02T09:00:00Z"));
    expect(made.batch).toBe("B-20261002-1");
    expect(made.termLabel).toBe("3rd Term 2025/2026");
    expect(made.pins).toHaveLength(25);
    // The seed has GFA-3T26-000147 and 000148.
    expect(made.pins[0].serial).toBe("GFA-3T26-000149");
    expect(made.pins[24].serial).toBe("GFA-3T26-000173");
    expect(made.pins.every((p) => /^\d{4} \d{4} \d{4}$/.test(p.pin))).toBe(true);
    const rows = await scope.findMany(t.resultPin, eq(t.resultPin.batch, made.batch));
    expect(rows).toHaveLength(25);
    expect(JSON.stringify(rows)).not.toContain(made.pins[0].pin.replace(/ /g, ""));
    expect(rows.every((r) => r.usesLeft === 3 && r.maxUses === 3)).toBe(true);
    const again = await generatePinBatch(scope, admin, { termId: lastTerm, count: 1, maxUses: 5 }, new Date("2026-10-02T10:00:00Z"));
    expect(again).toMatchObject({ batch: "B-20261002-2", pins: [{ serial: "GFA-3T26-000174" }] });
  });

  it("a new PIN opens a released report card the set number of times, and shows in the usage log", async () => {
    const pin = made.pins[0].pin;
    for (let i = 0; i < 3; i++) expect(await checkResult(db, { schoolId, admissionNo: "GFA/2021/0147", pin, termId: lastTerm })).toMatchObject({ ok: true, usesLeft: 2 - i });
    expect(await checkResult(db, { schoolId, admissionNo: "GFA/2021/0147", pin, termId: lastTerm })).toMatchObject({ ok: false, reason: "used_up" });
    const batches = await pinBatches(scope, admin, lastTerm);
    expect(batches.find((b) => b.batch === made.batch)).toMatchObject({ count: 25, used: 1, usedUp: 1 });
    expect(await pinUsage(scope, admin, lastTerm)).toEqual(expect.arrayContaining([expect.objectContaining({ serial: made.pins[0].serial, uses: 3, maxUses: 3, admissionNo: "GFA/2021/0147" })]));
  });

  it("prints a sheet only for this school's real PINs", async () => {
    const sheet = await checkPinsForSheet(scope, admin, made.pins.slice(0, 3));
    expect(sheet).toMatchObject({ termLabel: "3rd Term 2025/2026", pins: [{ serial: made.pins[0].serial, maxUses: 3 }, {}, {}] });
    await expect(checkPinsForSheet(scope, admin, [{ serial: made.pins[0].serial, pin: "1111 2222 3333" }])).rejects.toThrow(/don't belong/);
    await expect(checkPinsForSheet(scope, admin, [{ serial: made.pins[1].serial, pin: made.pins[0].pin }])).rejects.toThrow(/don't belong/);
    await expect(checkPinsForSheet(scope, musa, made.pins.slice(0, 1))).rejects.toThrow(/school admin/);
  });
});

describe("verify page", () => {
  it("reads codes typed loosely", () => {
    expect(normaliseCode("gfa 7q2m k9xd")).toBe("GFA-7Q2M-K9XD");
    expect(normaliseCode("GFA-7Q2M-K9XO")).toBe("GFA-7Q2M-K9X0");
    expect(normaliseCode("GFA-7Q2M-K9XDL")).toBeNull();
    expect(normaliseCode("hello")).toBeNull();
  });

  it("confirms a released card with the school's figures, and says when it's been withdrawn", async () => {
    const chiamaka = (await scope.findFirst(t.student, eq(t.student.admissionNo, "GFA/2021/0147")))!;
    const res = await getReportCard(scope, chiamaka.id, lastTerm);
    if (res.status !== "released") throw new Error("expected a released card");
    const code = res.card.verifyCode!;
    const ok = await verifyReportCard(db, code.toLowerCase().replace(/-/g, " "));
    expect(ok.status).toBe("valid");
    if (ok.status === "valid") expect(ok.card).toMatchObject({ average: res.card.average, position: res.card.position, verifyCode: code });
    expect(await verifyReportCard(db, "GFA-0000-0000")).toEqual({ status: "unknown" });

    await moveBatches(scope, admin, lastTerm, [jss2b], "unrelease", "Correcting a score");
    expect(await verifyReportCard(db, code)).toEqual({ status: "withdrawn", schoolName: "Greenfield Academy", termLabel: "3rd Term 2025/2026" });
    // Released again: same code, valid again.
    await expect(moveBatches(scope, admin, lastTerm, [jss2b], "submit")).rejects.toThrow("JSS2B is approved, so it can't be sent for review.");
    await moveBatches(scope, admin, lastTerm, [jss2b], "release");
    expect((await verifyReportCard(db, code)).status).toBe("valid");
    const codes = await scope.findMany(t.reportCardCode, and(eq(t.reportCardCode.termId, lastTerm), eq(t.reportCardCode.studentId, chiamaka.id))!);
    expect(codes).toHaveLength(1);
  });
});
