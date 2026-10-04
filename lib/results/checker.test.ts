import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createStudentAccount } from "@/lib/accounts";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { createTestDb } from "@/test/db";
import { seedSchoolFixture } from "@/test/fixtures";
import { checkResult } from "./checker";
import { hashPin } from "./pin";
import { getReportCard } from "./report-card";
import { tenantScope } from "@/lib/tenant/scope";
import { createResultToken, readResultToken } from "./token";

let db: Db;
let a: Awaited<ReturnType<typeof seedSchoolFixture>>;
let b: Awaited<ReturnType<typeof seedSchoolFixture>>;
let unreleasedTerm: string;
const ADM = "GFA/2021/0147";
const PIN_RELEASED = "4821 7730 5519";
const PIN_UNRELEASED = "9155 3028 7746";
const PIN_LIMITED = "1111 2222 3333";

beforeAll(async () => {
  process.env.RESULTS_TOKEN_SECRET = "test-results-secret";
  db = await createTestDb();
  a = await seedSchoolFixture(db, "a");
  b = await seedSchoolFixture(db, "b");
  const schoolId = a.school.id;

  const [t2] = await db
    .insert(t.term)
    .values({ schoolId, sessionId: a.ids.academicSession, number: 2 })
    .returning();
  unreleasedTerm = t2.id;
  await db.insert(t.enrollment).values({ schoolId, studentId: a.student.id, termId: t2.id, classArmId: a.ids.classArm });
  await db.insert(t.resultBatch).values({ schoolId, termId: t2.id, classArmId: a.ids.classArm, status: "under_review" });

  await db.insert(t.resultPin).values([
    { schoolId, termId: a.ids.term, serial: "S-1", pinHash: hashPin(schoolId, PIN_RELEASED) },
    { schoolId, termId: t2.id, serial: "S-2", pinHash: hashPin(schoolId, PIN_UNRELEASED) },
    { schoolId, termId: a.ids.term, serial: "S-3", pinHash: hashPin(schoolId, PIN_LIMITED), usesLeft: 1 },
  ]);
});

const usesLeft = async (serial: string) =>
  (await db.select().from(t.resultPin).where(eq(t.resultPin.serial, serial)))[0].usesLeft;

describe("checkResult", () => {
  it("opens a released result and uses one view", async () => {
    const res = await checkResult(db, { schoolId: a.school.id, admissionNo: ADM, pin: PIN_RELEASED, termId: a.ids.term });
    expect(res).toMatchObject({ ok: true, studentId: a.student.id, usesLeft: 4 });
    expect(await usesLeft("S-1")).toBe(4);
  });

  it("accepts PINs typed without spaces and admission numbers in lower case", async () => {
    const res = await checkResult(db, {
      schoolId: a.school.id,
      admissionNo: "gfa/2021/0147",
      pin: PIN_RELEASED.replace(/\s/g, ""),
      termId: a.ids.term,
    });
    expect(res.ok).toBe(true);
  });

  it('says "not yet released" for unreleased results, without using the PIN', async () => {
    const res = await checkResult(db, {
      schoolId: a.school.id,
      admissionNo: ADM,
      pin: PIN_UNRELEASED,
      termId: unreleasedTerm,
    });
    expect(res).toMatchObject({ ok: false, reason: "not_released" });
    expect(!res.ok && res.message).toMatch(/not been released yet/);
    expect(await usesLeft("S-2")).toBe(5);
  });

  it("rejects a wrong PIN or admission number with the same message", async () => {
    const wrongPin = await checkResult(db, { schoolId: a.school.id, admissionNo: ADM, pin: "0000 0000 0000", termId: a.ids.term });
    const wrongAdm = await checkResult(db, { schoolId: a.school.id, admissionNo: "GFA/1999/0001", pin: PIN_RELEASED, termId: a.ids.term });
    expect(wrongPin).toMatchObject({ ok: false, reason: "not_found" });
    expect(wrongAdm).toMatchObject({ ok: false, reason: "not_found" });
    expect(!wrongPin.ok && !wrongAdm.ok && wrongPin.message === wrongAdm.message).toBe(true);
  });

  it("does not accept a PIN at another school", async () => {
    const res = await checkResult(db, { schoolId: b.school.id, admissionNo: ADM, pin: PIN_RELEASED, termId: b.ids.term });
    expect(res).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("points to the right term when the PIN is for another term", async () => {
    const res = await checkResult(db, { schoolId: a.school.id, admissionNo: ADM, pin: PIN_RELEASED, termId: unreleasedTerm });
    expect(res).toMatchObject({ ok: false, reason: "wrong_term" });
  });

  it("stops after the usage limit", async () => {
    const first = await checkResult(db, { schoolId: a.school.id, admissionNo: ADM, pin: PIN_LIMITED, termId: a.ids.term });
    const second = await checkResult(db, { schoolId: a.school.id, admissionNo: ADM, pin: PIN_LIMITED, termId: a.ids.term });
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, reason: "used_up" });
  });

  it("binds a PIN to the first student it opens", async () => {
    const { student: other } = await createStudentAccount(db, {
      schoolId: a.school.id,
      admissionNo: "GFA/2021/0999",
      firstName: "Ngozi",
      lastName: "Eze",
      classArmId: a.ids.classArm,
      password: "whatever-123",
    });
    await db.insert(t.enrollment).values({ schoolId: a.school.id, studentId: other.id, termId: a.ids.term, classArmId: a.ids.classArm });
    const res = await checkResult(db, { schoolId: a.school.id, admissionNo: "GFA/2021/0999", pin: PIN_RELEASED, termId: a.ids.term });
    expect(res).toMatchObject({ ok: false, reason: "other_student" });
  });
});

describe("getReportCard", () => {
  it("returns the card for a released term", async () => {
    const res = await getReportCard(tenantScope(db, a.school.id), a.student.id, a.ids.term);
    expect(res.status).toBe("released");
    if (res.status === "released") {
      expect(res.card.subjects[0]).toMatchObject({ name: "Mathematics", total: 48 });
      expect(res.card.numberInClass).toBeGreaterThanOrEqual(1);
    }
  });

  it("returns nothing for an unreleased term", async () => {
    const res = await getReportCard(tenantScope(db, a.school.id), a.student.id, unreleasedTerm);
    expect(res.status).toBe("not_released");
  });

  it("cannot read another school's student", async () => {
    const res = await getReportCard(tenantScope(db, b.school.id), a.student.id, a.ids.term);
    expect(res.status).not.toBe("released");
  });
});

describe("result token", () => {
  it("round-trips and expires", () => {
    const tok = createResultToken({ schoolId: "s", studentId: "st", termId: "t" }, 0);
    expect(readResultToken(tok, 1000)).toMatchObject({ studentId: "st" });
    expect(readResultToken(tok, 31 * 60 * 1000)).toBeNull();
  });

  it("rejects tampering", () => {
    const tok = createResultToken({ schoolId: "s", studentId: "st", termId: "t" });
    const [p, s] = tok.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), studentId: "x" })).toString("base64url");
    expect(readResultToken(`${forged}.${s}`)).toBeNull();
  });
});
