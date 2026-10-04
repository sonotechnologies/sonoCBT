/**
 * Marking and results pipeline: theory marking, exam → CA grid, grid rules,
 * and the release workflow.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createStaffAccount, createStudentAccount } from "@/lib/accounts";
import type { Actor } from "@/lib/auth/permissions";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { addQuestions as addToBank } from "@/lib/questions/service";
import type { QuestionInput } from "@/lib/questions/model";
import { textDoc } from "@/lib/questions/rich";
import { addQuestions, createExam, getBuilder, PRESETS, publishExam, saveSchedule, saveSettings } from "@/lib/exams/builder";
import { startAttempt, syncAttempt } from "@/lib/exams/runtime";
import { markingQueue, markingSession, pushExamScores, saveMark, suggestMark } from "@/lib/marking/service";
import { createSchoolWithAdmin, saveClassesAndSubjects } from "@/lib/school/setup";
import { tenantScope, type TenantScope } from "@/lib/tenant/scope";
import { createTestDb } from "@/test/db";
import { broadsheet, changeLog, gridData, moveBatches, saveComponents, saveScale, saveScores } from "./pipeline";
import { WAEC_BANDS } from "@/lib/grading";

let db: Db;
let scope: TenantScope;
let admin: Actor;
let officer: Actor;
let teacher: Actor;
let otherTeacher: Actor;
let formTeacher: Actor;
let termId: string;
let arm: string;
let maths: string;
let english: string;
const kids: string[] = [];
let comps: Record<string, string>;
let examId: string;

const base = (over: Partial<QuestionInput> = {}): QuestionInput => ({
  type: "mcq_single",
  subjectId: maths,
  classLevelId: null,
  topicName: "",
  passageId: null,
  stem: textDoc("Q?"),
  marks: 1,
  difficulty: "easy",
  options: ["2", "5"].map((x, i) => ({ content: textDoc(x), isCorrect: i === 1 })),
  scoring: "all_or_nothing",
  trueFalse: null,
  accepted: [],
  caseSensitive: false,
  numericValue: "",
  tolerance: "",
  markingGuide: null,
  ...over,
});

/** A student's answer to the theory question (scripts are shown anonymised, in no fixed student order). */
async function answerOf(kid: number): Promise<string> {
  const theory = (await scope.findMany(t.examQuestion, eq(t.examQuestion.examId, examId))).find((x) => x.snapshot.type === "theory")!;
  const [a] = await scope.findMany(t.attempt, and(eq(t.attempt.examId, examId), eq(t.attempt.studentId, kids[kid]))!);
  const [ans] = await scope.findMany(t.attemptAnswer, and(eq(t.attemptAnswer.attemptId, a.id), eq(t.attemptAnswer.examQuestionId, theory.id))!);
  return ans.id;
}

beforeAll(async () => {
  db = await createTestDb();
  const { school, admin: user } = await createSchoolWithAdmin(db, { schoolName: "Results School", adminName: "A", email: "a@res.ng", password: "password-1" });
  scope = tenantScope(db, school.id);
  admin = { id: user.id, roles: [{ role: "school_admin", schoolId: school.id }] };
  await saveClassesAndSubjects(scope, {
    levels: [{ code: "JSS1", arms: ["A"] }],
    subjects: [
      { name: "Mathematics", stage: "all" },
      { name: "English Language", stage: "all" },
    ],
  });
  const subs = await scope.findMany(t.subject);
  maths = subs.find((s) => s.name === "Mathematics")!.id;
  english = subs.find((s) => s.name === "English Language")!.id;
  arm = (await scope.findMany(t.classArm))[0].id;
  const [session] = await scope.insert(t.academicSession, { name: "2026/2027", isCurrent: true });
  termId = (await scope.insert(t.term, { sessionId: session.id, number: 1, isCurrent: true }))[0].id;
  const mk = async (email: string, roles: { role: "teacher" | "exam_officer" | "form_teacher"; classArmId?: string }[]) => {
    const u = await createStaffAccount(db, { schoolId: school.id, name: email.split("@")[0], email, password: "password-1", roles });
    return { id: u.id, roles: roles.map((r) => ({ ...r, schoolId: school.id })) } as Actor;
  };
  teacher = await mk("maths@res.ng", [{ role: "teacher" }]);
  otherTeacher = await mk("eng@res.ng", [{ role: "teacher" }]);
  officer = await mk("officer@res.ng", [{ role: "exam_officer" }]);
  formTeacher = await mk("form@res.ng", [{ role: "teacher" }, { role: "form_teacher", classArmId: arm }]);
  for (const [subjectId, who] of [
    [maths, teacher],
    [english, otherTeacher],
  ] as const) {
    const done = await scope.update(t.subjectOffering, { teacherId: who.id }, and(eq(t.subjectOffering.subjectId, subjectId), eq(t.subjectOffering.classArmId, arm))!);
    if (!done.length) await scope.insert(t.subjectOffering, { subjectId, classArmId: arm, teacherId: who.id });
  }
  for (const [i, n] of ["Ada", "Bayo", "Chika", "Dayo"].entries()) {
    const { student } = await createStudentAccount(db, { schoolId: school.id, admissionNo: `R/${i}`, firstName: n, lastName: "Test", classArmId: arm, password: "password-1", mustChangePassword: false });
    kids.push(student.id);
  }
  await saveComponents(scope, admin, termId, [
    { name: "CA1", weight: 20 },
    { name: "CA2", weight: 20 },
    { name: "Exam", weight: 60 },
  ]);
  comps = Object.fromEntries((await scope.findMany(t.assessmentComponent, eq(t.assessmentComponent.termId, termId))).map((c) => [c.name, c.id]));
});

describe("setup", () => {
  it("refuses components that don't add up, and only lets the admin change them", async () => {
    await expect(saveComponents(scope, admin, termId, [{ name: "CA", weight: 30 }, { name: "Exam", weight: 60 }])).rejects.toThrow(/add up to 90/);
    await expect(saveComponents(scope, officer, termId, [{ name: "Exam", weight: 100 }])).rejects.toThrow(/admin/);
  });

  it("checks the grading scale", async () => {
    await expect(saveScale(scope, admin, WAEC_BANDS.filter((b) => b.grade !== "C5"))).rejects.toThrow(/gap/);
    await saveScale(scope, admin, WAEC_BANDS);
  });
});

describe("CA grid", () => {
  it("lets the subject teacher type scores, but not another subject's teacher", async () => {
    const changes = kids.map((studentId, i) => ({ studentId, componentId: comps.CA1, value: 10 + i }));
    expect(await saveScores(scope, teacher, { termId, classArmId: arm, subjectId: maths, changes })).toEqual({ saved: 4 });
    await expect(saveScores(scope, otherTeacher, { termId, classArmId: arm, subjectId: maths, changes })).rejects.toThrow(/can't enter/);
    // Unchanged scores aren't saved again.
    expect(await saveScores(scope, teacher, { termId, classArmId: arm, subjectId: maths, changes })).toEqual({ saved: 0 });
  });

  it("refuses a score above the component's maximum", async () => {
    await expect(saveScores(scope, teacher, { termId, classArmId: arm, subjectId: maths, changes: [{ studentId: kids[0], componentId: comps.CA1, value: 21 }] })).rejects.toThrow(/0 to 20/);
  });

  it("clears a score with null and logs changed scores", async () => {
    await saveScores(scope, teacher, { termId, classArmId: arm, subjectId: maths, changes: [{ studentId: kids[0], componentId: comps.CA1, value: 14 }] });
    await saveScores(scope, teacher, { termId, classArmId: arm, subjectId: maths, changes: [{ studentId: kids[3], componentId: comps.CA1, value: null }] });
    const g = await gridData(scope, teacher, termId, arm, maths);
    expect(g.students.find((s) => s.id === kids[0])!.values[comps.CA1]).toBe(14);
    expect(g.students.find((s) => s.id === kids[3])!.values[comps.CA1]).toBeUndefined();
    const log = await changeLog(scope, termId, arm);
    expect(log.some((l) => /1 changed/.test(l.what))).toBe(true);
  });
});

describe("theory marking and exam scores", () => {
  it("queues answered theory for the subject's teacher, anonymously", async () => {
    await addToBank(scope, admin, {
      subjectId: maths,
      submit: true,
      source: "manual",
      items: [{ input: base({ stem: textDoc("Objective one?"), marks: 2 }) }, { input: base({ type: "theory", options: [], stem: textDoc("Explain fractions."), marks: 6, markingGuide: textDoc("Numerator over denominator.") }) }],
    });
    examId = await createExam(scope, admin, { title: "Maths test", type: "ca_test", termId, subjectIds: [maths], classArmIds: [arm], durationMinutes: 30, calculator: "off", componentId: comps.Exam, aiMarking: true });
    const b = await getBuilder(scope, admin, examId);
    await addQuestions(scope, admin, examId, b.sections[0].id, (await scope.findMany(t.question)).map((q) => q.id));
    await saveSettings(scope, admin, examId, { integrity: "practice", integritySettings: PRESETS.practice, shuffleQuestions: false, shuffleOptions: false, showScoreAfterSubmit: false, calculator: "off", pinRequired: false });
    await saveSchedule(scope, admin, examId, { windowStart: new Date(Date.now() - 60_000), lateEntryUntil: null, venue: null, rooms: [] });
    await publishExam(scope, admin, examId, { seed: "x" });
    const eqs = (await scope.findMany(t.examQuestion, eq(t.examQuestion.examId, examId))).sort((a, b2) => a.sortOrder - b2.sortOrder);
    expect(eqs.every((q) => q.subjectId === maths)).toBe(true);
    const [obj, theory] = eqs;
    const right = obj.snapshot.options.find((o) => o.isCorrect)!.id;
    // Three students sit it; the fourth is absent.
    for (const [i, kid] of kids.slice(0, 3).entries()) {
      const a = await startAttempt(scope, kid, examId, { deviceSessionId: `d${i}` });
      await syncAttempt(scope, kid, {
        attemptId: a.id,
        deviceSessionId: `d${i}`,
        currentIndex: 1,
        answers: [
          { id: obj.id, response: { kind: "choice", optionIds: [right] }, flagged: false, seq: 1 },
          { id: theory.id, response: { kind: "text", text: i === 2 ? "" : `Answer ${i}` }, flagged: false, seq: 2 },
        ],
        submit: true,
      });
    }
    const q = await markingQueue(scope, teacher);
    expect(q).toEqual([expect.objectContaining({ examQuestionId: theory.id, total: 2, marked: 0 })]);
    expect(await markingQueue(scope, otherTeacher)).toEqual([]);
    const session = await markingSession(scope, teacher, theory.id);
    expect(session.scripts.map((s) => [s.n, s.name])).toEqual([
      [1, null],
      [2, null],
    ]);
  });

  it("won't send scores while theory is unmarked; marks are checked and changes audited", async () => {
    await expect(pushExamScores(scope, officer, examId)).rejects.toThrow(/2 theory answers still need marks/);
    const theory = (await scope.findMany(t.examQuestion, eq(t.examQuestion.examId, examId))).find((x) => x.snapshot.type === "theory")!;
    expect((await markingSession(scope, teacher, theory.id)).scripts).toHaveLength(2);
    await expect(saveMark(scope, teacher, await answerOf(0), 7, null)).rejects.toThrow(/0 to 6/);
    await expect(saveMark(scope, otherTeacher, await answerOf(0), 3, null)).rejects.toThrow(/can't mark/);
    await saveMark(scope, teacher, await answerOf(0), 4, "Good start");
    await saveMark(scope, teacher, await answerOf(0), 5, "Good start");
    await saveMark(scope, teacher, await answerOf(1), 3.5, null);
    const changes = await scope.findMany(t.auditLog, eq(t.auditLog.action, "marks.change"));
    expect(changes.map((c) => c.meta)).toEqual([expect.objectContaining({ from: 4, to: 5 })]);
  });

  it("stores an AI suggestion without applying it, sending only text", async () => {
    const theory = (await scope.findMany(t.examQuestion, eq(t.examQuestion.examId, examId))).find((x) => x.snapshot.type === "theory")!;
    let sent: Record<string, unknown> = {};
    const r = await suggestMark(scope, teacher, await answerOf(1), async (req) => {
      sent = req;
      return { marks: 6, points: [{ ok: true, text: "Defines numerator" }] };
    });
    expect(r.marks).toBe(6);
    expect(Object.keys(sent).sort()).toEqual(["answer", "guide", "maxMarks", "question"]);
    expect(JSON.stringify(sent)).not.toMatch(/Ada|Bayo|R\/0/);
    const after = await markingSession(scope, teacher, theory.id);
    const bayo = await answerOf(1);
    expect(after.scripts.find((x) => x.answerId === bayo)).toMatchObject({ marks: 3.5, aiMarks: 6 });
  });

  it("sends each student's marks to the grid, scaled to Exam /60", async () => {
    const r = await pushExamScores(scope, officer, examId);
    expect(r).toMatchObject({ students: 3, component: "Exam /60" });
    const g = await gridData(scope, officer, termId, arm, maths);
    const exam = (i: number) => g.students.find((s) => s.id === kids[i])!.values[comps.Exam];
    // Out of 8 (2 objective + 6 theory): Ada 2+5=7 → 52.5; Bayo 2+3.5=5.5 → 41.3; Chika 2+0 → 15; Dayo absent.
    expect([exam(0), exam(1), exam(2), exam(3)]).toEqual([52.5, 41.3, 15, undefined]);
    expect(g.students.find((s) => s.id === kids[0])!.sources[comps.Exam]).toBe("attempt");
    expect((await changeLog(scope, termId, arm)).some((l) => /Imported Mathematics exam scores from CBT \(3 students\)/.test(l.what))).toBe(true);
  });
});

describe("release workflow", () => {
  it("goes draft → review → approved → released, with the right people", async () => {
    await expect(moveBatches(scope, teacher, termId, [arm], "submit")).rejects.toThrow(/can't/);
    await moveBatches(scope, formTeacher, termId, [arm], "submit");
    // Locked for teachers now; a moderator needs a reason.
    await expect(saveScores(scope, teacher, { termId, classArmId: arm, subjectId: maths, changes: [{ studentId: kids[1], componentId: comps.CA2, value: 9 }] })).rejects.toThrow(/locked/);
    await expect(saveScores(scope, officer, { termId, classArmId: arm, subjectId: maths, changes: [{ studentId: kids[1], componentId: comps.CA2, value: 9 }] })).rejects.toThrow(/reason/);
    await saveScores(scope, officer, { termId, classArmId: arm, subjectId: maths, changes: [{ studentId: kids[1], componentId: comps.CA2, value: 9 }], reason: "Missing CA2 found" });

    await expect(moveBatches(scope, formTeacher, termId, [arm], "approve")).rejects.toThrow(/can't/);
    await moveBatches(scope, officer, termId, [arm], "approve");
    await expect(moveBatches(scope, officer, termId, [arm], "release")).rejects.toThrow(/can't/);
    await moveBatches(scope, admin, termId, [arm], "release");
    expect((await scope.findFirst(t.resultBatch, and(eq(t.resultBatch.termId, termId), eq(t.resultBatch.classArmId, arm))))!).toMatchObject({ status: "released", releasedBy: admin.id });
    await expect(moveBatches(scope, admin, termId, [arm], "unrelease")).rejects.toThrow(/reason/);
    await moveBatches(scope, admin, termId, [arm], "unrelease", "Wrong exam scores");
    const log = (await changeLog(scope, termId, arm)).map((l) => l.what);
    expect(log.slice(0, 4)).toEqual(["Un-released (Wrong exam scores)", "Released to students and parents", "Approved", expect.stringMatching(/Missing CA2 found/)]);
  });

  it("works out the broadsheet from the grid", async () => {
    const bs = await broadsheet(scope, officer, termId, arm);
    const ada = bs.students.find((s) => s.id === kids[0])!;
    expect(ada.subjects[maths]).toMatchObject({ total: 14 + 52.5 });
    expect(bs.subjects.find((s) => s.id === maths)!.ready).toBe(false);
  });
});
