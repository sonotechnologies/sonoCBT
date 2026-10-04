/**
 * Phase 6 acceptance: "Positions (with ties), grades and averages match a
 * hand-computed spreadsheet for the seed class."
 *
 * The seed class is Greenfield's JSS2B, 3rd Term 2025/2026 (the released term
 * whose report card parents see). Expected values are worked out here the way
 * a spreadsheet does it — SUM, AVERAGE, RANK.EQ, MAX, MIN and a grade lookup —
 * independently of the app's grading code, then compared with what the app
 * shows on the broadsheet and the report card. The same sheet, with live Excel
 * formulas, is in docs/acceptance (npm run acceptance:sheet).
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/permissions";
import * as t from "@/lib/db/schema";
import { tenantScope, type TenantScope } from "@/lib/tenant/scope";
import { createTestDb } from "@/test/db";
import { seedGreenfield } from "@/scripts/seed";
import { broadsheet } from "./pipeline";
import { getReportCard } from "./report-card";

// ─── The spreadsheet ─────────────────────────────────────────────────────────

/** =LOOKUP(total, {0,40,45,50,55,60,65,70,75}, {"F9","E8","D7","C6","C5","C4","B3","B2","A1"}) */
const LOOKUP: [number, string][] = [
  [75, "A1"],
  [70, "B2"],
  [65, "B3"],
  [60, "C4"],
  [55, "C5"],
  [50, "C6"],
  [45, "D7"],
  [40, "E8"],
  [0, "F9"],
];
const grade = (total: number) => LOOKUP.find(([min]) => total >= min)![1];
/** =RANK.EQ(x, range, 0): 1 + how many are strictly higher. */
const rankEq = (x: number, all: number[]) => 1 + all.filter((v) => v > x).length;
/** =ROUND(x, 1), half away from zero. */
const round1 = (x: number) => Math.sign(x) * Math.round(Math.abs(x) * 10 + 1e-9) / 10;

type Sheet = {
  rows: Map<string, { name: string; totals: Map<string, number>; total: number; average: number; position: number }>;
  subjects: Map<string, { name: string; average: number; highest: number; lowest: number }>;
};

function spreadsheet(entries: { studentId: string; subjectId: string; value: number }[], names: Map<string, string>, subjectNames: Map<string, string>): Sheet {
  const rows: Sheet["rows"] = new Map();
  for (const e of entries) {
    const r = rows.get(e.studentId) ?? { name: names.get(e.studentId)!, totals: new Map(), total: 0, average: 0, position: 0 };
    r.totals.set(e.subjectId, (r.totals.get(e.subjectId) ?? 0) + e.value); // =SUM(CA, Exam)
    rows.set(e.studentId, r);
  }
  for (const r of rows.values()) {
    const totals = [...r.totals.values()];
    r.total = totals.reduce((a, b) => a + b, 0); // =SUM(subjects)
    r.average = r.total / totals.length; // =AVERAGE(subjects)
  }
  const averages = [...rows.values()].map((r) => r.average);
  for (const r of rows.values()) r.position = rankEq(r.average, averages);
  const subjects: Sheet["subjects"] = new Map();
  for (const sid of new Set(entries.map((e) => e.subjectId))) {
    const col = [...rows.values()].filter((r) => r.totals.has(sid)).map((r) => r.totals.get(sid)!);
    subjects.set(sid, { name: subjectNames.get(sid)!, average: round1(col.reduce((a, b) => a + b, 0) / col.length), highest: Math.max(...col), lowest: Math.min(...col) });
  }
  return { rows, subjects };
}

// ─── The app ─────────────────────────────────────────────────────────────────

let scope: TenantScope;
let admin: Actor;
let termId: string;
let armId: string;
let sheet: Sheet;

beforeAll(async () => {
  process.env.RESULTS_TOKEN_SECRET ||= "acceptance-test-secret";
  const db = await createTestDb();
  const { school } = await seedGreenfield(db);
  scope = tenantScope(db, school.id);
  const adminUser = (await db.select().from(t.user).where(eq(t.user.email, "proprietor@greenfieldacademy.ng")))[0];
  admin = { id: adminUser.id, roles: [{ role: "school_admin", schoolId: school.id }] };
  const terms = await scope.findMany(t.term, eq(t.term.number, 3));
  termId = terms[0].id;
  armId = (await scope.findFirst(t.classArm, eq(t.classArm.name, "JSS2B")))!.id;

  const entries = await scope.findMany(t.scoreEntry, eq(t.scoreEntry.termId, termId));
  const students = await scope.findMany(t.student);
  const subjects = await scope.findMany(t.subject);
  sheet = spreadsheet(
    entries,
    new Map(students.map((s) => [s.id, `${s.firstName} ${s.lastName}`])),
    new Map(subjects.map((s) => [s.id, s.name])),
  );
}, 180_000);

describe("JSS2B · 3rd Term 2025/2026 matches the spreadsheet", () => {
  it("has the whole class: 38 students, 8 subjects", () => {
    expect(sheet.rows.size).toBe(38);
    expect(sheet.subjects.size).toBe(8);
  });

  it("includes a real tie (1st, 2nd, 2nd, 4th style)", () => {
    const rows = [...sheet.rows.values()];
    const at = (name: string) => rows.find((r) => r.name === name)!.position;
    // The seed gives these two identical scores in every subject.
    const tied = at("Ifeanyi Obi");
    expect(at("Zainab Yusuf")).toBe(tied);
    const positions = rows.map((r) => r.position);
    expect(positions.filter((p) => p === tied)).toHaveLength(2);
    expect(positions).not.toContain(tied + 1); // the next position is skipped
    expect(positions).toContain(tied + 2);
  });

  it("broadsheet: every student's subject totals, grades, subject positions, total, average and position", async () => {
    const bs = await broadsheet(scope, admin, termId, armId);
    expect(bs.numberInClass).toBe(38);
    for (const st of bs.students) {
      const want = sheet.rows.get(st.id)!;
      expect(st.total, st.name).toBe(want.total);
      expect(st.average, st.name).toBe(round1(want.average));
      expect(st.position, st.name).toBe(want.position);
      for (const [sid, total] of want.totals) {
        const col = [...sheet.rows.values()].filter((r) => r.totals.has(sid)).map((r) => r.totals.get(sid)!);
        expect(st.subjects[sid], `${st.name} · ${sheet.subjects.get(sid)!.name}`).toEqual({ total, grade: grade(total), position: rankEq(total, col), complete: true });
      }
    }
  });

  it("report card: Chiamaka's class average, highest and lowest per subject, and 'position out of'", async () => {
    const chiamaka = (await scope.findFirst(t.student, eq(t.student.admissionNo, "GFA/2021/0147")))!;
    const res = await getReportCard(scope, chiamaka.id, termId);
    expect(res.status).toBe("released");
    if (res.status !== "released") return;
    const want = sheet.rows.get(chiamaka.id)!;
    expect(res.card.position).toBe(want.position);
    expect(res.card.numberInClass).toBe(38);
    expect(res.card.average).toBe(round1(want.average));
    for (const sub of res.card.subjects) {
      const s = [...sheet.subjects.values()].find((x) => x.name === sub.name)!;
      expect({ avg: sub.classAverage, hi: sub.highest, lo: sub.lowest, grade: sub.grade }, sub.name).toEqual({ avg: s.average, hi: s.highest, lo: s.lowest, grade: grade(sub.total) });
    }
  });

  it("matches the design's report card for Chiamaka (6th of 38, the design's class averages)", async () => {
    const chiamaka = (await scope.findFirst(t.student, and(eq(t.student.firstName, "Chiamaka"), eq(t.student.lastName, "Okafor"))))!;
    expect(sheet.rows.get(chiamaka.id)!.position).toBe(6);
    const avgs = Object.fromEntries([...sheet.subjects.values()].map((s) => [s.name, s.average]));
    expect(avgs).toMatchObject({ "English Language": 61, Mathematics: 58, "Basic Science": 63, Yoruba: 52 });
  });
});
