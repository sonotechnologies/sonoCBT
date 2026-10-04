/**
 * Phase 8 acceptance: "Most-failed questions and weakest topics display for
 * seeded exams." Checked against figures worked out here from the raw answers.
 */
import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/permissions";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { tenantScope, type TenantScope } from "@/lib/tenant/scope";
import { createTestDb } from "@/test/db";
import { seedGreenfield } from "@/scripts/seed";
import { analyticsAccess, type AnalyticsAccess } from "./access";
import { toCsv } from "./csv";
import { analysableExams, examReport } from "./exam";
import { schoolOverview } from "./school";
import { discrimination } from "./stats";
import { topicMastery } from "./topics";

let db: Db;
let scope: TenantScope;
const all: AnalyticsAccess = { schoolWide: true, subjectIds: null };
let mathsExam: string;
let englishExam: string;
let termId: string;

async function actor(email: string): Promise<Actor> {
  const [u] = await db.select().from(t.user).where(eq(t.user.email, email));
  const roles = await db.select({ role: t.userRole.role, schoolId: t.userRole.schoolId, departmentId: t.userRole.departmentId, classArmId: t.userRole.classArmId }).from(t.userRole).where(eq(t.userRole.userId, u.id));
  return { id: u.id, roles };
}

beforeAll(async () => {
  db = await createTestDb();
  const { school } = await seedGreenfield(db);
  scope = tenantScope(db, school.id);
  const exams = await scope.findMany(t.exam);
  mathsExam = exams.find((e) => e.title === "Mathematics CA test 1")!.id;
  englishExam = exams.find((e) => e.title === "English CA test 1")!.id;
  termId = (await scope.findFirst(t.term, eq(t.term.isCurrent, true)))!.id;
});

describe("seeded exams", () => {
  it("lists the finished exams", async () => {
    expect((await analysableExams(scope, all)).map((e) => e.title).sort()).toEqual(["English CA test 1", "Mathematics CA test 1"]);
  });

  it("most-missed questions and their commonest wrong option match the raw answers", async () => {
    const r = await examReport(scope, all, mathsExam);
    const attempts = await scope.findMany(t.attempt, and(eq(t.attempt.examId, mathsExam), inArray(t.attempt.status, ["submitted", "auto_submitted"]))!);
    const answers = await scope.findMany(t.attemptAnswer, inArray(t.attemptAnswer.attemptId, attempts.map((a) => a.id)));
    const qs = await scope.findMany(t.examQuestion, eq(t.examQuestion.examId, mathsExam));
    const expected = qs
      .map((q) => {
        const mine = answers.filter((a) => a.examQuestionId === q.id);
        const right = mine.filter((a) => a.isCorrect).length;
        const wrongCounts = new Map<string, number>();
        for (const a of mine) if (!a.isCorrect && a.response?.kind === "choice") wrongCounts.set(a.response.optionIds[0], (wrongCounts.get(a.response.optionIds[0]) ?? 0) + 1);
        const top = [...wrongCounts].sort((x, y) => y[1] - x[1])[0];
        return { id: q.id, pct: Math.round((right / attempts.length) * 1000) / 10, wrongLetter: "ABCD"[q.snapshot.options.findIndex((o) => o.id === top[0])] };
      })
      .sort((a, b) => a.pct - b.pct);
    expect(r.stats.sat).toBe(attempts.length);
    expect(r.mostMissed).toHaveLength(5);
    for (const [i, m] of r.mostMissed.entries()) {
      expect(m.pctCorrect).toBe(expected[i].pct);
      expect(m.wrong?.letter).toBe(expected.find((e) => e.id === m.id)!.wrongLetter);
    }
    expect(r.mostMissed[0].pctCorrect).toBeLessThan(40);
    expect(r.distribution.reduce((a, d) => a + d.count, 0)).toBe(attempts.length);
  });

  it("weakest topics come out the same on the exam report and topic mastery, with each class's weak spot", async () => {
    const r = await examReport(scope, all, mathsExam);
    const m = await topicMastery(scope, all, { termId, subjectId: (await scope.findFirst(t.subject, eq(t.subject.name, "Mathematics")))!.id });
    expect(m.arms).toEqual(["JSS3A", "JSS3B"]);
    expect(m.weakest.map((w) => w.name).slice(0, 2)).toEqual(r.topics.slice(0, 2).map((x) => x.name));
    expect(["Logarithms", "Indices"]).toContain(m.weakest[0].name);
    const bases = m.topics.find((x) => x.name === "Number bases")!;
    expect(bases.cells[0].pct!).toBeLessThan(bases.cells[1].pct!); // JSS3A's weak spot
    const e = await examReport(scope, all, englishExam);
    expect(e.topics[0].name).toBe("Concord");
  });
});

describe("access, overview and exports", () => {
  it("an HOD sees their department's exams only; school overview is for school-wide staff", async () => {
    const hod = await analyticsAccess(scope, await actor("k.ade@greenfieldacademy.ng"));
    expect(hod?.schoolWide).toBe(false);
    expect((await analysableExams(scope, hod!)).map((e) => e.title)).toEqual(["Mathematics CA test 1"]);
    await expect(schoolOverview(scope, hod!, termId)).rejects.toThrow(/admin and exam officer/);
  });

  it("flags at-risk students by the stated rules", async () => {
    const o = await schoolOverview(scope, all, termId);
    expect(o.atRisk.length).toBeGreaterThan(0);
    for (const s of o.atRisk) expect(s.average < 40 || (s.change !== null && s.change <= -10)).toBe(true);
  });

  it("writes Excel-safe CSV", () => {
    expect(toCsv({ name: "x", columns: ["a", "b"], rows: [["=SUM(A1)", 'say "hi", ok'], [null, 2]] })).toBe('﻿a,b\r\n\'=SUM(A1),"say ""hi"", ok"\r\n,2\r\n');
    expect(discrimination(Array.from({ length: 10 }, (_, i) => ({ scorePct: i / 10, credit: i >= 5 ? 1 : 0 })))).toBe(1);
  });
});
