/**
 * Builder → publish → take → submit, against a real (in-memory) Postgres.
 */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createStudentAccount } from "@/lib/accounts";
import type { Actor } from "@/lib/auth/permissions";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import type { QuestionInput } from "@/lib/questions/model";
import { textDoc } from "@/lib/questions/rich";
import { addQuestions as addToBank, saveQuestion, savePassage } from "@/lib/questions/service";
import { createSchoolWithAdmin, saveClassesAndSubjects } from "@/lib/school/setup";
import { tenantScope, type TenantScope } from "@/lib/tenant/scope";
import { createTestDb } from "@/test/db";
import {
  addDrawRule,
  addQuestions,
  createExam,
  examSlips,
  getBuilder,
  publishExam,
  publishIssues,
  saveSchedule,
  saveSettings,
  PRESETS,
  unpublishExam,
} from "./builder";
import { SYNC_GRACE_MS } from "./rules";
import { buildPayload, getAttempt, startAttempt, syncAttempt } from "./runtime";
import type { SyncAnswer } from "./runtime-types";

let db: Db;
let scope: TenantScope;
let otherScope: TenantScope;
let admin: Actor;
let maths: string;
let english: string;
let jss1: string;
let jss1a: string;
let termId: string;
const students: { id: string; firstName: string; lastName: string }[] = [];
let examId: string;

const base = (over: Partial<QuestionInput> = {}): QuestionInput => ({
  type: "mcq_single",
  subjectId: maths,
  classLevelId: jss1,
  topicName: "Fractions",
  passageId: null,
  stem: textDoc("What is half of 10?"),
  marks: 1,
  difficulty: "easy",
  options: ["2", "5", "10", "20"].map((x, i) => ({ content: textDoc(x), isCorrect: i === 1 })),
  scoring: "all_or_nothing",
  trueFalse: null,
  accepted: [],
  caseSensitive: false,
  numericValue: "",
  tolerance: "",
  markingGuide: null,
  ...over,
});

beforeAll(async () => {
  process.env.RESULTS_TOKEN_SECRET ||= "test-secret-for-exam-pins";
  db = await createTestDb();
  const { school, admin: user } = await createSchoolWithAdmin(db, { schoolName: "Exam School", adminName: "A", email: "a@exam.ng", password: "password-1" });
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
  jss1 = (await scope.findMany(t.classLevel))[0].id;
  jss1a = (await scope.findMany(t.classArm))[0].id;
  const [session] = await scope.insert(t.academicSession, { name: "2026/2027", isCurrent: true });
  const [term] = await scope.insert(t.term, { sessionId: session.id, number: 1, isCurrent: true });
  termId = term.id;
  for (const [first, last] of [["Chiamaka", "Okafor"], ["Tunde", "Bakare"], ["Halima", "Yusuf"]]) {
    const { student } = await createStudentAccount(db, { schoolId: school.id, admissionNo: `GFA/${last}`, firstName: first, lastName: last, classArmId: jss1a, password: "password-1", mustChangePassword: false });
    students.push(student);
  }

  // A bank: 12 maths objectives, 1 of each other type, a 2-question passage in English.
  await addToBank(scope, admin, {
    subjectId: maths,
    submit: true,
    source: "manual",
    items: [
      ...Array.from({ length: 12 }, (_, i) => ({ input: base({ stem: textDoc(`Maths objective ${i + 1}?`), difficulty: i % 2 ? "medium" : "easy" }) })),
      { input: base({ type: "true_false", stem: textDoc("Every square is a rectangle."), options: [], trueFalse: true }) },
      { input: base({ type: "fill_blank", stem: textDoc("The unit of force is the ____."), options: [], accepted: ["newton"] }) },
      { input: base({ type: "numeric", stem: textDoc("What is 3/4 as a decimal?"), options: [], numericValue: "0.75", tolerance: "0" }) },
      { input: base({ type: "theory", stem: textDoc("Explain how to add fractions."), options: [], marks: 5, markingGuide: textDoc("Common denominator.") }) },
    ],
  });
  const p = await savePassage(scope, admin, { subjectId: english, classLevelId: jss1, title: "Market Day", content: textDoc("Every fifth day the market comes alive.") });
  for (const s of ["How often is the market held?", "Who sells akara?"]) {
    await saveQuestion(scope, admin, { input: base({ subjectId: english, passageId: p.id, stem: textDoc(s), topicName: "Comprehension" }), submit: true });
  }
  otherScope = tenantScope(db, (await createSchoolWithAdmin(db, { schoolName: "Other", adminName: "O", email: "o@x.ng", password: "password-1" })).school.id);
});

const bank = async (subjectId: string) => scope.findMany(t.question, eq(t.question.subjectId, subjectId));

describe("building and publishing", () => {
  it("creates a draft with a section per subject and the preset for its type", async () => {
    examId = await createExam(scope, admin, {
      title: "JSS1 Test",
      type: "ca_test",
      termId,
      subjectIds: [english, maths],
      classArmIds: [jss1a],
      durationMinutes: 40,
      calculator: "basic",
    });
    const b = await getBuilder(scope, admin, examId);
    expect(b.sections.map((s) => s.title)).toEqual(["English Language", "Mathematics"]);
    expect(b.exam.integrity).toBe("standard");
    expect(b.exam.integritySettings).toEqual(PRESETS.standard);
    expect(await publishIssues(scope, examId)).toContain("Add some questions.");
  });

  it("adds picked questions (passage kept together) and a random draw", async () => {
    const b = await getBuilder(scope, admin, examId);
    const [engSec, mathSec] = b.sections;
    const eng = (await bank(english)).sort((a, b) => a.number - b.number);
    await addQuestions(scope, admin, examId, engSec.id, eng.map((q) => q.id));
    const mq = await bank(maths);
    const picks = mq.filter((q) => q.type !== "mcq_single");
    await addQuestions(scope, admin, examId, mathSec.id, picks.map((q) => q.id));
    await expect(addDrawRule(scope, admin, examId, mathSec.id, { subjectId: maths, classLevelId: null, topicId: null, difficulty: "easy", count: 7, marksEach: 1 })).rejects.toThrow(/Only 6/);
    await addDrawRule(scope, admin, examId, mathSec.id, { subjectId: maths, classLevelId: null, topicId: null, difficulty: "easy", count: 5, marksEach: 2 });

    const after = await getBuilder(scope, admin, examId);
    expect(after.sections.map((s) => s.questionCount)).toEqual([2, 9]);
    expect(after.sections[1].marks).toBe(1 + 1 + 1 + 5 + 5 * 2);
    expect(after.exam.totalMarks).toBe(2 + 18);
  });

  it("refuses unapproved questions", async () => {
    const [draft] = await addToBank(scope, admin, { subjectId: maths, submit: false, source: "manual", items: [{ input: base({ stem: textDoc("A draft?") }) }] });
    const b = await getBuilder(scope, admin, examId);
    await expect(addQuestions(scope, admin, examId, b.sections[1].id, [draft.ok ? draft.id : ""])).rejects.toThrow(/approved/);
  });

  it("publishes: freezes content, draws, seats everyone and makes PINs", async () => {
    const now = new Date();
    await saveSettings(scope, admin, examId, { integrity: "strict", integritySettings: PRESETS.strict, shuffleQuestions: true, shuffleOptions: true, showScoreAfterSubmit: true, calculator: "off", pinRequired: true });
    await saveSchedule(scope, admin, examId, { windowStart: new Date(now.getTime() - 5 * 60_000), lateEntryUntil: new Date(now.getTime() + 10 * 60_000), venue: "ICT Lab 1", rooms: [{ classArmId: jss1a, venue: "ICT Lab 2", invigilatorId: null }] });
    const res = await publishExam(scope, admin, examId, { now, seed: "fixed" });
    expect(res).toEqual({ questions: 11, candidates: 3, pins: 3 });
    const e = (await scope.findFirst(t.exam, eq(t.exam.id, examId)))!;
    expect(e.status).toBe("scheduled");
    expect(e.windowEnd.getTime()).toBe(e.lateEntryUntil!.getTime() + 40 * 60_000);

    // Editing the bank afterwards doesn't change the exam.
    const eq1 = (await scope.findMany(t.examQuestion, eq(t.examQuestion.examId, examId)))[0];
    await scope.update(t.question, { stem: textDoc("Changed later") }, eq(t.question.id, eq1.questionId!));
    const again = (await scope.findFirst(t.examQuestion, eq(t.examQuestion.id, eq1.id)))!;
    expect(JSON.stringify(again.snapshot.stem)).not.toContain("Changed later");

    const slips = await examSlips(scope, admin, examId);
    expect(slips.classes[0].slips.map((s) => s.seat)).toEqual(["01", "02", "03"]);
    expect(slips.classes[0].slips.map((s) => s.name)).toEqual(["Tunde Bakare", "Chiamaka Okafor", "Halima Yusuf"]);
    expect(slips.classes[0].slips.every((s) => /^[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(s.pin!))).toBe(true);
    expect(slips.classes[0].venue).toBe("ICT Lab 2");
  });
});

describe("taking the exam", () => {
  const pinFor = async (studentId: string) => (await examSlips(scope, admin, examId)).classes[0].slips.find((s) => s.studentId === studentId)!.pin!;

  it("needs the right PIN, then resumes the same attempt without it", async () => {
    const chi = students[0];
    await expect(startAttempt(scope, chi.id, examId, { pin: "AAAA-BBBB" })).rejects.toThrow(/PIN/);
    const a = await startAttempt(scope, chi.id, examId, { pin: (await pinFor(chi.id)).toLowerCase() });
    const b = await startAttempt(scope, chi.id, examId, {});
    expect(b.id).toBe(a.id);
    expect(a.questionOrder).toHaveLength(11);
    expect(a.deadlineAt.getTime() - a.startedAt.getTime()).toBe(40 * 60_000);
  });

  it("gives each student their own order, with the passage questions together", async () => {
    const a = (await getAttempt(scope, students[0].id, examId))!;
    const b = await startAttempt(scope, students[1].id, examId, { pin: await pinFor(students[1].id) });
    expect(a.questionOrder).not.toEqual(b.questionOrder);
    const eqs = await scope.findMany(t.examQuestion, eq(t.examQuestion.examId, examId));
    const passageIds = new Set(eqs.filter((q) => q.snapshot.passage).map((q) => q.id));
    const idx = a.questionOrder.map((id, i) => (passageIds.has(id) ? i : -1)).filter((i) => i >= 0);
    expect(idx[1] - idx[0]).toBe(1);
    expect(idx[0]).toBeLessThan(2); // English section comes first
  });

  it("never sends correct answers to the student", async () => {
    const a = (await getAttempt(scope, students[0].id, examId))!;
    const school = (await db.select().from(t.school).where(eq(t.school.id, scope.schoolId)))[0];
    const student = (await scope.findFirst(t.student, eq(t.student.id, students[0].id)))!;
    const payload = await buildPayload(scope, a, { school, student, schoolSlug: school.slug, className: "JSS1A" });
    const text = JSON.stringify(payload);
    expect(text).not.toMatch(/isCorrect|accepted|markingGuide|"answer"|newton|0\.75|Common denominator/);
    expect(payload.questions).toHaveLength(11);
    expect(Object.values(payload.passages)[0].label).toMatch(/Questions \d+–\d+/);
  });

  it("keeps the newest write per question and ignores bad or stale ones", async () => {
    const a = (await getAttempt(scope, students[0].id, examId))!;
    const eqs = await scope.findMany(t.examQuestion, eq(t.examQuestion.examId, examId));
    const mcq = eqs.find((q) => q.snapshot.type === "mcq_single")!;
    const right = mcq.snapshot.options.find((o) => o.isCorrect)!.id;
    const wrong = mcq.snapshot.options.find((o) => !o.isCorrect)!.id;
    const send = (answers: SyncAnswer[], currentIndex = 3) => syncAttempt(scope, students[0].id, { attemptId: a.id, deviceSessionId: "dev-1", currentIndex, answers });

    expect(await send([{ id: mcq.id, response: { kind: "choice", optionIds: [right] }, flagged: true, seq: 5 }])).toMatchObject({ ok: true, status: "in_progress", ackSeq: 5 });
    // An older retry arriving late loses.
    await send([{ id: mcq.id, response: { kind: "choice", optionIds: [wrong] }, flagged: false, seq: 3 }]);
    // Nonsense for this question is dropped.
    await send([{ id: mcq.id, response: { kind: "text", text: "hack" }, flagged: false, seq: 9 }]);
    const [saved] = await scope.findMany(t.attemptAnswer, eq(t.attemptAnswer.examQuestionId, mcq.id));
    expect(saved.response).toEqual({ kind: "choice", optionIds: [right] });
    expect(saved.flagged).toBe(true);
    const row = (await getAttempt(scope, students[0].id, examId))!;
    expect(row.currentIndex).toBe(3);
    expect(row.answeredCount).toBe(1);
  });

  it("won't let another school's scope or another student touch the attempt", async () => {
    const a = (await getAttempt(scope, students[0].id, examId))!;
    expect(await syncAttempt(otherScope, students[0].id, { attemptId: a.id, deviceSessionId: "x", currentIndex: 0, answers: [] })).toMatchObject({ ok: false });
    expect(await syncAttempt(scope, students[1].id, { attemptId: a.id, deviceSessionId: "x", currentIndex: 0, answers: [] })).toMatchObject({ ok: false });
  });

  it("marks everything on submit and shows the score when nothing waits for a teacher", async () => {
    const a = (await getAttempt(scope, students[0].id, examId))!;
    const eqs = await scope.findMany(t.examQuestion, eq(t.examQuestion.examId, examId));
    const answers: SyncAnswer[] = eqs
      .filter((q) => q.snapshot.type !== "theory")
      .map((q, i) => {
        const s = q.snapshot;
        const response =
          s.type === "true_false"
            ? { kind: "bool" as const, value: true }
            : s.type === "fill_blank"
              ? { kind: "text" as const, text: "Newton" }
              : s.type === "numeric"
                ? { kind: "text" as const, text: "3/4" }
                : { kind: "choice" as const, optionIds: [s.options.find((o) => o.isCorrect)!.id] };
        return { id: q.id, response, flagged: false, seq: 10 + i };
      });
    const res = await syncAttempt(scope, students[0].id, { attemptId: a.id, deviceSessionId: "dev-1", currentIndex: 10, answers, submit: true });
    const max = eqs.reduce((s, q) => s + q.marks, 0);
    expect(res).toMatchObject({ ok: true, status: "submitted", summary: { answered: 10, total: 11, score: { score: max - 5, max }, auto: false } });
    // Submitting again changes nothing.
    const again = await syncAttempt(scope, students[0].id, { attemptId: a.id, deviceSessionId: "dev-1", currentIndex: 0, answers: [] });
    expect(again).toMatchObject({ status: "submitted", summary: { answered: 10 } });
  });

  it("auto-submits once time (plus grace) runs out, and keeps late answers aside", async () => {
    const a = (await getAttempt(scope, students[1].id, examId))!;
    const eqs = await scope.findMany(t.examQuestion, eq(t.examQuestion.examId, examId));
    const q = eqs.find((x) => x.snapshot.type === "mcq_single")!;
    const pick = { kind: "choice" as const, optionIds: [q.snapshot.options[0].id] };
    // Inside the grace: still accepted.
    const inGrace = new Date(a.deadlineAt.getTime() + SYNC_GRACE_MS - 1000);
    expect(await syncAttempt(scope, students[1].id, { attemptId: a.id, deviceSessionId: "d", currentIndex: 0, answers: [{ id: q.id, response: pick, flagged: false, seq: 1 }] }, inGrace)).toMatchObject({ status: "in_progress" });
    // After it: the server finishes the attempt; a newer answer is kept aside, not marked.
    const late = new Date(a.deadlineAt.getTime() + SYNC_GRACE_MS + 1000);
    const res = await syncAttempt(scope, students[1].id, { attemptId: a.id, deviceSessionId: "d", currentIndex: 0, answers: [{ id: q.id, response: { kind: "choice", optionIds: [] }, flagged: false, seq: 2 }] }, late);
    expect(res).toMatchObject({ ok: true, status: "submitted", lateCount: 1, summary: { auto: true, answered: 1 } });
    const row = (await getAttempt(scope, students[1].id, examId))!;
    expect(row.status).toBe("auto_submitted");
    expect(row.submittedAt!.getTime()).toBe(a.deadlineAt.getTime());
  });

  it("refuses a first start after late entry closes", async () => {
    const late = new Date(Date.now() + 11 * 60_000);
    await expect(startAttempt(scope, students[2].id, examId, { pin: await pinFor(students[2].id), now: late })).rejects.toThrow(/Late entry/);
  });

  it("can't be unpublished once students have started", async () => {
    await expect(unpublishExam(scope, admin, examId)).rejects.toThrow(/already started/);
  });
});
