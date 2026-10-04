/**
 * Phase 5: integrity rules on the server and the live monitor's actions.
 */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createStaffAccount, createStudentAccount } from "@/lib/accounts";
import type { Actor } from "@/lib/auth/permissions";
import type { Db } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import type { QuestionInput } from "@/lib/questions/model";
import { textDoc } from "@/lib/questions/rich";
import { addQuestions as addToBank } from "@/lib/questions/service";
import { createSchoolWithAdmin, saveClassesAndSubjects } from "@/lib/school/setup";
import { tenantScope, type TenantScope } from "@/lib/tenant/scope";
import { createTestDb } from "@/test/db";
import { addQuestions, createExam, getBuilder, PRESETS, publishExam, saveSchedule, saveSettings } from "./builder";
import { TAKEOVER_AFTER_MS } from "./integrity";
import { acceptLateAnswers, addTime, addTimeForEveryone, forceSubmit, monitorData, resetSession, restartAttempt, studentTimeline } from "./monitor";
import { SYNC_GRACE_MS } from "./rules";
import { getAttempt, saveSnapshot, startAttempt, syncAttempt } from "./runtime";
import { readPrivate } from "@/lib/storage";
import type { SyncRequest } from "./runtime-types";

let db: Db;
let scope: TenantScope;
let admin: Actor;
let invigilator: Actor;
let otherTeacher: Actor;
let maths: string;
let armA: string;
let armB: string;
const kids: string[] = [];
let examId: string;
let q1: string;
const staff = () => ({ actor: admin, name: "Mrs. Adebayo" });

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

const sync = (studentId: string, attemptId: string, over: Partial<SyncRequest> = {}, now = new Date(), ip: string | null = null) =>
  syncAttempt(scope, studentId, { attemptId, deviceSessionId: "dev-A", currentIndex: 0, answers: [], ...over }, now, ip);

beforeAll(async () => {
  db = await createTestDb();
  const { school, admin: user } = await createSchoolWithAdmin(db, { schoolName: "Integrity School", adminName: "A", email: "a@int.ng", password: "password-1" });
  scope = tenantScope(db, school.id);
  admin = { id: user.id, roles: [{ role: "school_admin", schoolId: school.id }] };
  await saveClassesAndSubjects(scope, { levels: [{ code: "JSS1", arms: ["A", "B"] }], subjects: [{ name: "Mathematics", stage: "all" }] });
  maths = (await scope.findMany(t.subject))[0].id;
  const arms = (await scope.findMany(t.classArm)).sort((x, y) => x.name.localeCompare(y.name));
  [armA, armB] = arms.map((a) => a.id);
  const [session] = await scope.insert(t.academicSession, { name: "2026/2027", isCurrent: true });
  const [term] = await scope.insert(t.term, { sessionId: session.id, number: 1, isCurrent: true });
  const mkTeacher = async (email: string) => {
    const u = await createStaffAccount(db, { schoolId: school.id, name: email, email, password: "password-1", roles: [{ role: "teacher" }] });
    return { id: u.id, roles: [{ role: "teacher" as const, schoolId: school.id }] };
  };
  invigilator = await mkTeacher("inv@int.ng");
  otherTeacher = await mkTeacher("other@int.ng");
  for (let i = 0; i < 6; i++) {
    const { student } = await createStudentAccount(db, { schoolId: school.id, admissionNo: `INT/${i}`, firstName: `Kid${i}`, lastName: "Test", classArmId: i < 5 ? armA : armB, password: "password-1", mustChangePassword: false });
    kids.push(student.id);
  }
  await addToBank(scope, admin, { subjectId: maths, submit: true, source: "manual", items: [1, 2, 3].map((n) => ({ input: base({ stem: textDoc(`Question ${n}?`) }) })) });

  examId = await createExam(scope, admin, { title: "Strict test", type: "mock", termId: term.id, subjectIds: [maths], classArmIds: [armA, armB], durationMinutes: 30, calculator: "off" });
  const b = await getBuilder(scope, admin, examId);
  await addQuestions(scope, admin, examId, b.sections[0].id, (await scope.findMany(t.question)).map((q) => q.id));
  await saveSettings(scope, admin, examId, { integrity: "strict", integritySettings: PRESETS.strict, shuffleQuestions: false, shuffleOptions: false, showScoreAfterSubmit: false, calculator: "off", pinRequired: false });
  const now = Date.now();
  await saveSchedule(scope, admin, examId, { windowStart: new Date(now - 60_000), lateEntryUntil: null, venue: null, rooms: [{ classArmId: armA, venue: "Lab A", invigilatorId: invigilator.id }] });
  await publishExam(scope, admin, examId, { seed: "x" });
  q1 = (await scope.findMany(t.examQuestion, eq(t.examQuestion.examId, examId))).sort((x, y) => x.sortOrder - y.sortOrder)[0].id;
});

describe("tab switching (Strict: auto-submit after 3)", () => {
  it("counts each leave once, warns, and submits on the third", async () => {
    const a = await startAttempt(scope, kids[0], examId, { deviceSessionId: "dev-A" });
    const leave = (seq: number) => ({ seq, type: "tab_hidden" as const, at: Date.now(), awayMs: 8000 });
    expect(await sync(kids[0], a.id, { events: [leave(1)] })).toMatchObject({ status: "in_progress", leaves: 1, eventAck: 1 });
    // A retry of the same event changes nothing.
    expect(await sync(kids[0], a.id, { events: [leave(1), leave(2)] })).toMatchObject({ status: "in_progress", leaves: 2 });
    // Copying is recorded (and flagged) but isn't a leave.
    expect(await sync(kids[0], a.id, { events: [{ seq: 3, type: "copy", at: Date.now() }] })).toMatchObject({ leaves: 2 });
    const third = await sync(kids[0], a.id, { events: [leave(4)], answers: [{ id: q1, response: { kind: "choice", optionIds: [] }, flagged: false, seq: 1 }] });
    expect(third).toMatchObject({ ok: true, status: "submitted", summary: { auto: true, reason: "integrity" } });
    const row = (await getAttempt(scope, kids[0], examId))!;
    expect(row).toMatchObject({ status: "auto_submitted", submitReason: "integrity", leaveCount: 3, integrityFlags: 4 });
    const timeline = await studentTimeline(scope, admin, examId, kids[0]);
    expect(timeline.map((e) => e.type)).toEqual(["started", "tab_hidden", "tab_hidden", "copy", "tab_hidden", "auto_submitted"]);
    expect(timeline.at(-1)!.detail).toBe("after 3 tab switches");
  });

  it("shows on the monitor as submitted and flagged", async () => {
    const data = await monitorData(scope, admin, examId);
    const s = data.students.find((x) => x.studentId === kids[0])!;
    expect(s).toMatchObject({ status: "submitted", flags: 4, leaves: 3, submitReason: "integrity" });
    expect(data.counts.notstarted).toBe(5);
  });
});

describe("one device per student", () => {
  it("blocks a second computer, logs it once, and lets the invigilator release it", async () => {
    const a = await startAttempt(scope, kids[1], examId, { deviceSessionId: "dev-A" });
    expect(await sync(kids[1], a.id, { deviceSessionId: "dev-B" })).toMatchObject({ ok: false, blocked: "device" });
    expect(await sync(kids[1], a.id, { deviceSessionId: "dev-B" })).toMatchObject({ ok: false, blocked: "device" });
    await expect(startAttempt(scope, kids[1], examId, { deviceSessionId: "dev-B" })).rejects.toThrow(/another computer/);
    const tl = await studentTimeline(scope, admin, examId, kids[1]);
    expect(tl.filter((e) => e.type === "multi_session")).toHaveLength(1);
    expect((await getAttempt(scope, kids[1], examId))!.integrityFlags).toBe(1);

    await resetSession(scope, staff(), examId, kids[1]);
    expect(await sync(kids[1], a.id, { deviceSessionId: "dev-B" })).toMatchObject({ ok: true, status: "in_progress" });
    // Now the first computer is the stranger.
    expect(await sync(kids[1], a.id, { deviceSessionId: "dev-A" })).toMatchObject({ ok: false, blocked: "device" });
  });

  it("lets a new device take over once the first has gone quiet", async () => {
    const a = (await getAttempt(scope, kids[1], examId))!;
    const later = new Date(a.lastSeenAt!.getTime() + TAKEOVER_AFTER_MS + 1000);
    expect(await sync(kids[1], a.id, { deviceSessionId: "dev-C" }, later)).toMatchObject({ ok: true });
    expect((await studentTimeline(scope, admin, examId, kids[1])).some((e) => e.type === "device_moved")).toBe(true);
  });
});

describe("school network only", () => {
  it("blocks starting and syncing from outside the allowed range", async () => {
    await scope.update(t.exam, { integritySettings: { ...PRESETS.strict, allowedIps: ["102.89.4.0/24"] } }, eq(t.exam.id, examId));
    await expect(startAttempt(scope, kids[2], examId, { deviceSessionId: "d2", ip: "41.1.1.1" })).rejects.toThrow(/school's network/);
    const a = await startAttempt(scope, kids[2], examId, { deviceSessionId: "d2", ip: "102.89.4.17" });
    expect(await sync(kids[2], a.id, { deviceSessionId: "d2" }, new Date(), "41.1.1.1")).toMatchObject({ ok: false, blocked: "network" });
    expect(await sync(kids[2], a.id, { deviceSessionId: "d2" }, new Date(), "102.89.4.20")).toMatchObject({ ok: true });
    await scope.update(t.exam, { integritySettings: PRESETS.strict }, eq(t.exam.id, examId));
  });
});

describe("identity photos", () => {
  it("stores a photo privately, at most every two minutes, only when the exam takes them", async () => {
    const a = await startAttempt(scope, kids[4], examId, { deviceSessionId: "d4" });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(await saveSnapshot(scope, kids[4], a.id, jpeg)).toMatchObject({ ok: false, error: /doesn't take photos/ });
    await scope.update(t.exam, { integritySettings: { ...PRESETS.strict, snapshot: true } }, eq(t.exam.id, examId));
    expect(await saveSnapshot(scope, kids[4], a.id, new Uint8Array([1, 2, 3]))).toMatchObject({ ok: false });
    expect(await saveSnapshot(scope, kids[4], a.id, jpeg)).toEqual({ ok: true });
    expect(await saveSnapshot(scope, kids[4], a.id, jpeg)).toEqual({ ok: true });
    const shots = (await scope.findMany(t.integrityEvent, eq(t.integrityEvent.attemptId, a.id))).filter((e) => e.type === "snapshot");
    expect(shots).toHaveLength(1);
    expect(await readPrivate(String(shots[0].meta?.key))).toEqual(jpeg);
    expect(await saveSnapshot(scope, kids[0], a.id, jpeg)).toMatchObject({ ok: false });
    await scope.update(t.exam, { integritySettings: PRESETS.strict }, eq(t.exam.id, examId));
  });
});

describe("monitor actions", () => {
  it("adds time for one student and reopens a timed-out exam", async () => {
    const a = (await getAttempt(scope, kids[2], examId))!;
    await addTime(scope, staff(), examId, kids[2], 5);
    expect((await getAttempt(scope, kids[2], examId))!.deadlineAt.getTime()).toBe(a.deadlineAt.getTime() + 5 * 60_000);
    // Time runs out while their PC is dead; the server submits; the invigilator gives 10 minutes.
    const late = new Date(a.deadlineAt.getTime() + 5 * 60_000 + SYNC_GRACE_MS + 1000);
    expect(await sync(kids[2], a.id, { deviceSessionId: "d2" }, late)).toMatchObject({ status: "submitted", summary: { reason: "timeout" } });
    await addTime(scope, staff(), examId, kids[2], 10, late);
    const reopened = (await getAttempt(scope, kids[2], examId))!;
    expect(reopened.status).toBe("in_progress");
    expect(reopened.deadlineAt.getTime()).toBe(late.getTime() + 10 * 60_000);
  });

  it("adds time for everyone writing and moves the window", async () => {
    const before = (await scope.findFirst(t.exam, eq(t.exam.id, examId)))!.windowEnd.getTime();
    const n = await addTimeForEveryone(scope, staff(), examId, 5);
    expect(n).toBeGreaterThanOrEqual(2);
    expect((await scope.findFirst(t.exam, eq(t.exam.id, examId)))!.windowEnd.getTime()).toBe(before + 5 * 60_000);
  });

  it("force-submits with a reason, and the student sees it was staff", async () => {
    const a = (await getAttempt(scope, kids[2], examId))!;
    await forceSubmit(scope, staff(), examId, kids[2], "Caught with a phone");
    expect(await sync(kids[2], a.id, { deviceSessionId: "d2" })).toMatchObject({ status: "submitted", summary: { reason: "staff" } });
    const tl = await studentTimeline(scope, admin, examId, kids[2]);
    expect(tl.find((e) => e.type === "force_submitted")).toMatchObject({ detail: "by Mrs. Adebayo: Caught with a phone" });
  });

  it("counts late answers after an outage and re-marks", async () => {
    const a = await startAttempt(scope, kids[3], examId, { deviceSessionId: "d3" });
    const after = new Date(a.deadlineAt.getTime() + SYNC_GRACE_MS + 60_000);
    const eq1 = (await scope.findFirst(t.examQuestion, eq(t.examQuestion.id, q1)))!;
    const right = eq1.snapshot.options.find((o) => o.isCorrect)!.id;
    expect(await sync(kids[3], a.id, { deviceSessionId: "d3", answers: [{ id: q1, response: { kind: "choice", optionIds: [right] }, flagged: false, seq: 5 }] }, after)).toMatchObject({ status: "submitted", lateCount: 1 });
    expect((await getAttempt(scope, kids[3], examId))!.score).toBe(0);
    expect(await acceptLateAnswers(scope, staff(), examId, kids[3])).toBe(1);
    expect((await getAttempt(scope, kids[3], examId))!).toMatchObject({ score: 1, lateAnswers: null });
  });

  it("starts an attempt again only with a reason", async () => {
    await expect(restartAttempt(scope, staff(), examId, kids[3], "")).rejects.toThrow(/reason/);
    await restartAttempt(scope, staff(), examId, kids[3], "Wrong student sat at the PC");
    expect(await getAttempt(scope, kids[3], examId)).toBeUndefined();
  });

  it("lets an invigilator see and act only on their own room", async () => {
    const mine = await monitorData(scope, invigilator, examId);
    expect(mine.scoped).toBe(true);
    expect(mine.students.every((s) => s.className.endsWith("A"))).toBe(true);
    expect(mine.students).toHaveLength(5);
    await expect(addTime(scope, { actor: invigilator, name: "Inv" }, examId, kids[5], 5)).rejects.toThrow(/not found/);
    await expect(addTimeForEveryone(scope, { actor: invigilator, name: "Inv" }, examId, 5)).rejects.toThrow(/exam officer/);
    await expect(monitorData(scope, otherTeacher, examId)).rejects.toThrow(/not found/);
  });
});
