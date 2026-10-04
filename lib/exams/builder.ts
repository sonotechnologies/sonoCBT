/**
 * Exam builder: drafts, sections (picked questions + random-draw rules),
 * settings, schedule, publish and slips. Every function checks `exam.manage`
 * and goes through the tenant scope.
 */
import { examsBlock, featureBlock } from "@/lib/billing/gate";
import { and, asc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { can, type Actor } from "@/lib/auth/permissions";
import {
  assessmentComponent,
  attempt,
  classArm,
  classLevel,
  exam,
  examAssignment,
  examCandidate,
  examDrawRule,
  examPin,
  examQuestion,
  examSection,
  examSectionItem,
  examSubject,
  passage,
  question,
  questionOption,
  student,
  subject,
  topic,
  type ExamQuestionSnapshot,
  type IntegritySettings,
} from "@/lib/db/schema";
import { questionCode } from "@/lib/questions/model";
import type { TenantScope } from "@/lib/tenant/scope";
import { generateExamPin, hashExamPin, sealPin, unsealPin } from "./pin";
import { validNetwork } from "./integrity";
import { PRESETS } from "./presets";
import { buildOrder, seededRandom, shuffle } from "./rules";
import { renderQuestions } from "./runtime";
import type { RuntimePayload } from "./runtime-types";

export class ExamError extends Error {}

type ExamRow = typeof exam.$inferSelect;
type Preset = ExamRow["integrity"];
export type ExamType = ExamRow["type"];

export { PRESETS };

export const TYPE_LABEL: Record<ExamType, string> = {
  ca_test: "CA test",
  exam: "Exam",
  mock: "Mock",
  entrance: "Entrance exam",
  practice: "Practice",
};

/** Draft → Scheduled (before it opens) → Live (window open) → Closed. */
export function examPhaseStatus(e: Pick<ExamRow, "status" | "windowStart" | "windowEnd">, now: Date): "draft" | "scheduled" | "live" | "closed" {
  if (e.status === "draft") return "draft";
  if (e.status === "closed" || now >= e.windowEnd) return "closed";
  return now >= e.windowStart ? "live" : "scheduled";
}

// ─── Loading & permission ────────────────────────────────────────────────────

/** An exam belongs to a department when all its subjects do (so a department's HOD can run it). */
export async function departmentOf(scope: TenantScope, examId: string): Promise<string | null> {
  const rows = await scope.query((db, owns) =>
    db
      .select({ departmentId: subject.departmentId })
      .from(examSubject)
      .innerJoin(subject, owns(subject, eq(subject.id, examSubject.subjectId)))
      .where(owns(examSubject, eq(examSubject.examId, examId))),
  );
  const ids = new Set(rows.map((r) => r.departmentId));
  return ids.size === 1 ? [...ids][0] : null;
}

export async function loadExamForEdit(scope: TenantScope, actor: Actor, examId: string): Promise<ExamRow> {
  const e = await scope.findFirst(exam, eq(exam.id, examId));
  if (!e) throw new ExamError("Exam not found.");
  if (!can(actor, "exam.manage", { schoolId: scope.schoolId, departmentId: await departmentOf(scope, examId) })) {
    throw new ExamError("You can't change this exam.");
  }
  return e;
}

async function editableDraft(scope: TenantScope, actor: Actor, examId: string) {
  const e = await loadExamForEdit(scope, actor, examId);
  if (e.status !== "draft") throw new ExamError("This exam is published. Unpublish it to make changes.");
  return e;
}

// ─── Create & details ────────────────────────────────────────────────────────

export type DetailsInput = {
  title: string;
  fullTitle?: string | null;
  series?: string | null;
  type: ExamType;
  termId: string;
  subjectIds: string[];
  classArmIds: string[];
  durationMinutes: number;
  instructions?: string | null;
  calculator: "off" | "basic" | "scientific";
  /** The term's result component this exam feeds (e.g. Exam /60). */
  componentId?: string | null;
  /** Offer AI score suggestions when teachers mark theory. */
  aiMarking?: boolean;
};

function checkDetails(d: DetailsInput) {
  if (!d.title.trim()) throw new ExamError("Give the exam a title.");
  if (!d.subjectIds.length) throw new ExamError("Choose at least one subject.");
  if (!d.classArmIds.length) throw new ExamError("Choose at least one class.");
  if (!Number.isInteger(d.durationMinutes) || d.durationMinutes < 5 || d.durationMinutes > 360) {
    throw new ExamError("Duration must be between 5 and 360 minutes.");
  }
}

async function checkRefs(scope: TenantScope, d: DetailsInput) {
  const [subs, arms] = await Promise.all([
    scope.findMany(subject, inArray(subject.id, d.subjectIds)),
    scope.findMany(classArm, inArray(classArm.id, d.classArmIds)),
  ]);
  if (subs.length !== new Set(d.subjectIds).size) throw new ExamError("Choose subjects from this school.");
  if (arms.length !== new Set(d.classArmIds).size) throw new ExamError("Choose classes from this school.");
  if (d.componentId) {
    const c = await scope.findFirst(assessmentComponent, eq(assessmentComponent.id, d.componentId));
    if (!c || c.termId !== d.termId) throw new ExamError("Choose a result component from the exam's term.");
  }
}

/** Default schedule for a new draft: the next weekday at 09:00, late entry 15 minutes. */
export function defaultWindow(now: Date, durationMinutes: number) {
  const d = new Date(now.getTime() + 86400_000);
  while ([0, 6].includes(new Date(d.getTime() + 3600_000).getUTCDay())) d.setTime(d.getTime() + 86400_000);
  const day = new Date(d.getTime() + 3600_000).toISOString().slice(0, 10);
  const start = new Date(`${day}T09:00:00+01:00`);
  const lateEntryUntil = new Date(start.getTime() + 15 * 60_000);
  return { windowStart: start, lateEntryUntil, windowEnd: new Date(lateEntryUntil.getTime() + durationMinutes * 60_000) };
}

export async function createExam(scope: TenantScope, actor: Actor, d: DetailsInput, now = new Date()): Promise<string> {
  const blocked = await examsBlock(scope);
  if (blocked) throw new ExamError(blocked);
  checkDetails(d);
  if (!can(actor, "exam.manage", { schoolId: scope.schoolId })) {
    // An HOD may create an exam for their own department's subjects.
    const subs = await scope.findMany(subject, inArray(subject.id, d.subjectIds));
    const depts = new Set(subs.map((s) => s.departmentId));
    const dept = depts.size === 1 ? [...depts][0] : null;
    if (!can(actor, "exam.manage", { schoolId: scope.schoolId, departmentId: dept })) throw new ExamError("You can't create exams.");
  }
  await checkRefs(scope, d);
  return scope.transaction(async (tx) => {
    const [row] = await tx.insert(exam, {
      termId: d.termId,
      title: d.title.trim(),
      fullTitle: d.fullTitle?.trim() || null,
      series: d.series?.trim() || null,
      type: d.type,
      durationMinutes: d.durationMinutes,
      instructions: d.instructions?.trim() || null,
      calculator: d.calculator,
      componentId: d.componentId ?? null,
      aiMarking: !!d.aiMarking,
      integrity: d.type === "practice" ? "practice" : d.type === "mock" || d.type === "exam" ? "strict" : "standard",
      showScoreAfterSubmit: d.type === "ca_test" || d.type === "practice",
      graded: d.type !== "practice",
      createdBy: actor.id,
      ...defaultWindow(now, d.durationMinutes),
    });
    await tx.update(exam, { integritySettings: PRESETS[row.integrity] }, eq(exam.id, row.id));
    await tx.insert(examSubject, d.subjectIds.map((subjectId, i) => ({ examId: row.id, subjectId, sortOrder: i })));
    await tx.insert(examAssignment, d.classArmIds.map((classArmId) => ({ examId: row.id, classArmId })));
    // One section per subject to start with; the exam officer can rename, merge or add.
    const subs = await tx.findMany(subject, inArray(subject.id, d.subjectIds));
    await tx.insert(
      examSection,
      d.subjectIds.map((sid, i) => ({
        examId: row.id,
        title: subs.find((s) => s.id === sid)!.name,
        subjectId: sid,
        sortOrder: i + 1,
        questionCount: 0,
        marks: 0,
      })),
    );
    await tx.query((db) => audit(db, { schoolId: tx.schoolId, actorUserId: actor.id, action: "exam.create", entityType: "exam", entityId: row.id }));
    return row.id;
  });
}

export async function saveDetails(scope: TenantScope, actor: Actor, examId: string, d: DetailsInput) {
  const e = await editableDraft(scope, actor, examId);
  checkDetails(d);
  await checkRefs(scope, d);
  await scope.transaction(async (tx) => {
    await tx.update(
      exam,
      {
        title: d.title.trim(),
        fullTitle: d.fullTitle?.trim() || null,
        series: d.series?.trim() || null,
        type: d.type,
        termId: d.termId,
        durationMinutes: d.durationMinutes,
        instructions: d.instructions?.trim() || null,
        calculator: d.calculator,
        componentId: d.componentId ?? null,
        aiMarking: !!d.aiMarking,
        // Keep the close time consistent with a new duration.
        windowEnd: new Date((e.lateEntryUntil ?? e.windowStart).getTime() + d.durationMinutes * 60_000),
      },
      eq(exam.id, examId),
    );
    await tx.delete(examSubject, eq(examSubject.examId, examId));
    await tx.insert(examSubject, d.subjectIds.map((subjectId, i) => ({ examId, subjectId, sortOrder: i })));
    const keep = await tx.findMany(examAssignment, eq(examAssignment.examId, examId));
    await tx.delete(examAssignment, and(eq(examAssignment.examId, examId), notInArray(examAssignment.classArmId, d.classArmIds))!);
    const add = d.classArmIds.filter((id) => !keep.some((k) => k.classArmId === id));
    await tx.insert(examAssignment, add.map((classArmId) => ({ examId, classArmId })));
  });
}

// ─── Sections, picks and draw rules ──────────────────────────────────────────

/** Keeps each section's question count and marks (and the exam total) in step with its contents. */
async function recount(scope: TenantScope, examId: string) {
  const [sections, items, rules] = await Promise.all([
    scope.findMany(examSection, eq(examSection.examId, examId)),
    scope.query((db, owns) =>
      db
        .select({ sectionId: examSectionItem.sectionId, marks: examSectionItem.marks, qMarks: question.marks })
        .from(examSectionItem)
        .innerJoin(question, owns(question, eq(question.id, examSectionItem.questionId)))
        .where(owns(examSectionItem, eq(examSectionItem.examId, examId))),
    ),
    scope.findMany(examDrawRule, eq(examDrawRule.examId, examId)),
  ]);
  let total = 0;
  for (const s of sections) {
    const its = items.filter((i) => i.sectionId === s.id);
    const rs = rules.filter((r) => r.sectionId === s.id);
    const count = its.length + rs.reduce((a, r) => a + r.count, 0);
    const marks = its.reduce((a, i) => a + (i.marks ?? i.qMarks), 0) + rs.reduce((a, r) => a + r.count * (r.marksEach ?? 1), 0);
    total += marks;
    if (s.questionCount !== count || s.marks !== Math.round(marks)) {
      await scope.update(examSection, { questionCount: count, marks: Math.round(marks) }, eq(examSection.id, s.id));
    }
  }
  await scope.update(exam, { totalMarks: Math.round(total) }, eq(exam.id, examId));
}

export async function saveSection(scope: TenantScope, actor: Actor, examId: string, s: { id?: string; title: string; subjectId: string | null }) {
  await editableDraft(scope, actor, examId);
  if (!s.title.trim()) throw new ExamError("Give the section a title.");
  if (s.subjectId && !(await scope.findFirst(subject, eq(subject.id, s.subjectId)))) throw new ExamError("Choose a subject.");
  if (s.id) {
    const [row] = await scope.update(examSection, { title: s.title.trim(), subjectId: s.subjectId }, and(eq(examSection.id, s.id), eq(examSection.examId, examId))!);
    if (!row) throw new ExamError("Section not found.");
    return row.id;
  }
  const existing = await scope.findMany(examSection, eq(examSection.examId, examId));
  const [row] = await scope.insert(examSection, {
    examId,
    title: s.title.trim(),
    subjectId: s.subjectId,
    sortOrder: existing.length + 1,
    questionCount: 0,
    marks: 0,
  });
  return row.id;
}

export async function deleteSection(scope: TenantScope, actor: Actor, examId: string, sectionId: string) {
  await editableDraft(scope, actor, examId);
  await scope.delete(examSection, and(eq(examSection.id, sectionId), eq(examSection.examId, examId))!);
  const rest = (await scope.findMany(examSection, eq(examSection.examId, examId))).sort((a, b) => a.sortOrder - b.sortOrder);
  for (const [i, s] of rest.entries()) if (s.sortOrder !== i + 1) await scope.update(examSection, { sortOrder: i + 1 }, eq(examSection.id, s.id));
  await recount(scope, examId);
}

export async function moveSection(scope: TenantScope, actor: Actor, examId: string, sectionId: string, dir: -1 | 1) {
  await editableDraft(scope, actor, examId);
  const list = (await scope.findMany(examSection, eq(examSection.examId, examId))).sort((a, b) => a.sortOrder - b.sortOrder);
  const i = list.findIndex((s) => s.id === sectionId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  await scope.update(examSection, { sortOrder: list[j].sortOrder }, eq(examSection.id, list[i].id));
  await scope.update(examSection, { sortOrder: list[i].sortOrder }, eq(examSection.id, list[j].id));
}

async function sectionOf(scope: TenantScope, examId: string, sectionId: string) {
  const s = await scope.findFirst(examSection, and(eq(examSection.id, sectionId), eq(examSection.examId, examId)));
  if (!s) throw new ExamError("Section not found.");
  return s;
}

/** Adds approved bank questions to a section (skipping ones already in the exam). */
export async function addQuestions(scope: TenantScope, actor: Actor, examId: string, sectionId: string, questionIds: string[]) {
  await editableDraft(scope, actor, examId);
  await sectionOf(scope, examId, sectionId);
  const qs = await scope.findMany(question, and(inArray(question.id, questionIds), eq(question.status, "approved")));
  if (qs.length !== new Set(questionIds).size) throw new ExamError("Only approved questions can go into an exam.");
  const already = new Set((await scope.findMany(examSectionItem, eq(examSectionItem.examId, examId))).map((i) => i.questionId));
  const inSection = await scope.findMany(examSectionItem, eq(examSectionItem.sectionId, sectionId));
  let order = inSection.reduce((m, i) => Math.max(m, i.sortOrder), 0);
  // Keep a passage's questions next to each other, in their bank order.
  const fresh = questionIds.filter((id) => !already.has(id));
  await scope.insert(examSectionItem, fresh.map((questionId) => ({ examId, sectionId, questionId, sortOrder: ++order })));
  await recount(scope, examId);
  return fresh.length;
}

export async function removeQuestion(scope: TenantScope, actor: Actor, examId: string, itemId: string) {
  await editableDraft(scope, actor, examId);
  await scope.delete(examSectionItem, and(eq(examSectionItem.id, itemId), eq(examSectionItem.examId, examId))!);
  await recount(scope, examId);
}

export async function setItemMarks(scope: TenantScope, actor: Actor, examId: string, itemId: string, marks: number | null) {
  await editableDraft(scope, actor, examId);
  if (marks !== null && !(marks > 0 && marks <= 100)) throw new ExamError("Marks must be between 0 and 100.");
  await scope.update(examSectionItem, { marks }, and(eq(examSectionItem.id, itemId), eq(examSectionItem.examId, examId))!);
  await recount(scope, examId);
}

export type DrawRuleInput = {
  subjectId: string;
  classLevelId: string | null;
  topicId: string | null;
  difficulty: "easy" | "medium" | "hard" | null;
  count: number;
  marksEach: number;
};

type PoolFilter = Pick<DrawRuleInput, "subjectId" | "classLevelId" | "topicId" | "difficulty">;

/** Approved questions a rule can draw from, excluding ones picked by hand. */
function drawPool(scope: TenantScope, examId: string, r: PoolFilter) {
  return scope.query((db, owns) =>
    db
      .select({ id: question.id, passageId: question.passageId })
      .from(question)
      .where(
        owns(
          question,
          and(
            eq(question.subjectId, r.subjectId),
            eq(question.status, "approved"),
            r.classLevelId ? eq(question.classLevelId, r.classLevelId) : undefined,
            r.topicId ? eq(question.topicId, r.topicId) : undefined,
            r.difficulty ? eq(question.difficulty, r.difficulty) : undefined,
            // Passage questions only come in with their passage, so random draws skip them.
            isNull(question.passageId),
            sql`${question.id} not in (select ${examSectionItem.questionId} from ${examSectionItem} where ${examSectionItem.examId} = ${examId})`,
          ),
        ),
      ),
  );
}

export async function countDrawPool(scope: TenantScope, examId: string, r: PoolFilter): Promise<number> {
  return (await drawPool(scope, examId, r)).length;
}

export async function addDrawRule(scope: TenantScope, actor: Actor, examId: string, sectionId: string, r: DrawRuleInput) {
  await editableDraft(scope, actor, examId);
  await sectionOf(scope, examId, sectionId);
  if (!Number.isInteger(r.count) || r.count < 1 || r.count > 200) throw new ExamError("Draw between 1 and 200 questions.");
  if (!(r.marksEach > 0 && r.marksEach <= 100)) throw new ExamError("Marks must be between 0 and 100.");
  const available = await countDrawPool(scope, examId, r);
  if (available < r.count) throw new ExamError(`Only ${available} approved questions match. Lower the number or widen the rule.`);
  await scope.insert(examDrawRule, { examId, sectionId, ...r });
  await recount(scope, examId);
}

export async function removeDrawRule(scope: TenantScope, actor: Actor, examId: string, ruleId: string) {
  await editableDraft(scope, actor, examId);
  await scope.delete(examDrawRule, and(eq(examDrawRule.id, ruleId), eq(examDrawRule.examId, examId))!);
  await recount(scope, examId);
}

// ─── Settings & schedule ─────────────────────────────────────────────────────

export type SettingsInput = {
  integrity: Preset;
  integritySettings: IntegritySettings;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showScoreAfterSubmit: boolean;
  calculator: "off" | "basic" | "scientific";
  pinRequired: boolean;
};

export async function saveSettings(scope: TenantScope, actor: Actor, examId: string, s: SettingsInput) {
  await editableDraft(scope, actor, examId);
  if (s.integritySettings.snapshot) {
    const blocked = await featureBlock(scope, "snapshots");
    if (blocked) throw new ExamError(blocked);
  }
  const n = s.integritySettings.submitAfterLeaves;
  if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= 20)) throw new ExamError("Auto-submit needs a number of tab switches between 1 and 20.");
  const nets = (s.integritySettings.allowedIps ?? []).map((x) => x.trim()).filter(Boolean);
  if (nets.length > 20) throw new ExamError("List at most 20 networks.");
  const bad = nets.find((x) => !validNetwork(x));
  if (bad) throw new ExamError(`"${bad}" isn't a network address. Use forms like 102.89.4.0/24 or 41.58.10.7.`);
  s = { ...s, integritySettings: { ...s.integritySettings, allowedIps: nets } };
  await scope.update(exam, s, eq(exam.id, examId));
}

export type ScheduleInput = {
  windowStart: Date;
  lateEntryUntil: Date | null;
  venue: string | null;
  rooms: { classArmId: string; venue: string | null; invigilatorId: string | null }[];
};

export async function saveSchedule(scope: TenantScope, actor: Actor, examId: string, s: ScheduleInput) {
  const e = await editableDraft(scope, actor, examId);
  if (s.lateEntryUntil && s.lateEntryUntil < s.windowStart) throw new ExamError("Late entry must end after the exam opens.");
  if (s.lateEntryUntil && s.lateEntryUntil.getTime() - s.windowStart.getTime() > 6 * 3600_000) throw new ExamError("Late entry can't run more than 6 hours.");
  // Everyone who starts before late entry closes gets the full time.
  const windowEnd = new Date((s.lateEntryUntil ?? s.windowStart).getTime() + e.durationMinutes * 60_000);
  await scope.transaction(async (tx) => {
    await tx.update(exam, { windowStart: s.windowStart, lateEntryUntil: s.lateEntryUntil, windowEnd, venue: s.venue?.trim() || null }, eq(exam.id, examId));
    for (const r of s.rooms) {
      await tx.update(
        examAssignment,
        { venue: r.venue?.trim() || null, invigilatorId: r.invigilatorId },
        and(eq(examAssignment.examId, examId), eq(examAssignment.classArmId, r.classArmId))!,
      );
    }
  });
}

// ─── Publish ─────────────────────────────────────────────────────────────────

async function snapshots(scope: TenantScope, ids: string[]): Promise<Map<string, ExamQuestionSnapshot>> {
  if (!ids.length) return new Map();
  const [qs, opts] = await Promise.all([
    scope.query((db, owns) =>
      db
        .select({ q: question, subjectName: subject.name, subjectCode: subject.code, topicName: topic.name, passage })
        .from(question)
        .innerJoin(subject, owns(subject, eq(subject.id, question.subjectId)))
        .leftJoin(topic, owns(topic, eq(topic.id, question.topicId)))
        .leftJoin(passage, owns(passage, eq(passage.id, question.passageId)))
        .where(owns(question, inArray(question.id, ids))),
    ),
    scope.findMany(questionOption, inArray(questionOption.questionId, ids)),
  ]);
  const out = new Map<string, ExamQuestionSnapshot>();
  for (const r of qs) {
    const options = opts
      .filter((o) => o.questionId === r.q.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((o) => ({ id: o.id, content: o.content, isCorrect: o.isCorrect }));
    out.set(r.q.id, {
      type: r.q.type,
      stem: r.q.stem,
      options,
      answer: r.q.answer,
      passage: r.passage ? { id: r.passage.id, title: r.passage.title, content: r.passage.content } : null,
      code: questionCode(r.subjectName, r.subjectCode, r.q.number),
      topicName: r.topicName,
    });
  }
  return out;
}

export type PublishIssue = string;

/** What stops an exam being published, in plain words. Empty = ready. */
export async function publishIssues(scope: TenantScope, examId: string, now = new Date()): Promise<PublishIssue[]> {
  const e = await scope.findFirst(exam, eq(exam.id, examId));
  if (!e) return ["Exam not found."];
  const issues: string[] = [];
  const [sections, items, rules, arms] = await Promise.all([
    scope.findMany(examSection, eq(examSection.examId, examId)),
    scope.query((db, owns) =>
      db
        .select({ status: question.status })
        .from(examSectionItem)
        .innerJoin(question, owns(question, eq(question.id, examSectionItem.questionId)))
        .where(owns(examSectionItem, eq(examSectionItem.examId, examId))),
    ),
    scope.findMany(examDrawRule, eq(examDrawRule.examId, examId)),
    scope.findMany(examAssignment, eq(examAssignment.examId, examId)),
  ]);
  if (!arms.length) issues.push("Choose at least one class.");
  if (!items.length && !rules.length) issues.push("Add some questions.");
  if (items.some((i) => i.status !== "approved")) issues.push("Some picked questions are no longer approved. Remove them or get them approved.");
  const empty = sections.filter((s) => s.questionCount === 0);
  if (empty.length) issues.push(`Section "${empty[0].title}" has no questions. Add some or delete it.`);
  for (const r of rules) {
    const n = await countDrawPool(scope, examId, r);
    if (n < r.count) issues.push(`A random draw needs ${r.count} questions but only ${n} approved ones match.`);
  }
  if (e.windowEnd <= now) issues.push("The exam's time has already passed. Pick a new date on Schedule.");
  return issues;
}

/**
 * Publishes a draft: draws random questions, freezes every question's content,
 * seats the candidates and (if asked) generates PINs. All or nothing.
 */
export async function publishExam(scope: TenantScope, actor: Actor, examId: string, opts: { now?: Date; seed?: string } = {}) {
  const now = opts.now ?? new Date();
  const e = await editableDraft(scope, actor, examId);
  const blocked = await examsBlock(scope);
  if (blocked) throw new ExamError(blocked);
  const issues = await publishIssues(scope, examId, now);
  if (issues.length) throw new ExamError(issues[0]);
  const rand = seededRandom(opts.seed ?? `${examId}:${now.getTime()}`);

  return scope.transaction(async (tx) => {
    const sections = (await tx.findMany(examSection, eq(examSection.examId, examId))).sort((a, b) => a.sortOrder - b.sortOrder);
    const items = await tx.findMany(examSectionItem, eq(examSectionItem.examId, examId));
    const rules = await tx.findMany(examDrawRule, eq(examDrawRule.examId, examId));

    const chosen: { sectionId: string; questionId: string; marks: number | null; order: number }[] = [];
    let order = 0;
    const used = new Set(items.map((i) => i.questionId));
    for (const s of sections) {
      for (const it of items.filter((i) => i.sectionId === s.id).sort((a, b) => a.sortOrder - b.sortOrder)) {
        chosen.push({ sectionId: s.id, questionId: it.questionId, marks: it.marks, order: ++order });
      }
      for (const r of rules.filter((x) => x.sectionId === s.id)) {
        const pool = (await drawPool(tx, examId, r)).filter((p) => !used.has(p.id));
        const drawn = shuffle(pool, rand).slice(0, r.count);
        if (drawn.length < r.count) throw new ExamError("Not enough approved questions for a random draw.");
        for (const d of drawn) {
          used.add(d.id);
          chosen.push({ sectionId: s.id, questionId: d.id, marks: r.marksEach, order: ++order });
        }
      }
    }

    const snaps = await snapshots(tx, chosen.map((c) => c.questionId));
    const bankRows = await tx.findMany(question, inArray(question.id, chosen.map((c) => c.questionId)));
    const bankMarks = new Map(bankRows.map((q) => [q.id, q.marks]));
    const bankSubject = new Map(bankRows.map((q) => [q.id, q.subjectId]));
    await tx.delete(examQuestion, eq(examQuestion.examId, examId));
    const rows = chosen.map((c) => ({
      examId,
      sectionId: c.sectionId,
      questionId: c.questionId,
      subjectId: bankSubject.get(c.questionId) ?? null,
      sortOrder: c.order,
      marks: c.marks ?? bankMarks.get(c.questionId) ?? 1,
      snapshot: snaps.get(c.questionId)!,
    }));
    await tx.insert(examQuestion, rows);
    let total = 0;
    for (const s of sections) {
      const mine = rows.filter((r) => r.sectionId === s.id);
      const marks = mine.reduce((a, r) => a + r.marks, 0);
      total += marks;
      await tx.update(examSection, { questionCount: mine.length, marks: Math.round(marks) }, eq(examSection.id, s.id));
    }

    // Seat everyone in the assigned classes, numbered per class in surname order.
    const arms = await tx.findMany(examAssignment, eq(examAssignment.examId, examId));
    const students = await tx.findMany(student, inArray(student.classArmId, arms.map((a) => a.classArmId)));
    await tx.delete(examCandidate, eq(examCandidate.examId, examId));
    const seats: { examId: string; studentId: string; seat: string }[] = [];
    for (const a of arms) {
      const mine = students.filter((s) => s.classArmId === a.classArmId).sort((x, y) => `${x.lastName} ${x.firstName}`.localeCompare(`${y.lastName} ${y.firstName}`));
      mine.forEach((s, i) => seats.push({ examId, studentId: s.id, seat: String(i + 1).padStart(2, "0") }));
    }
    await tx.insert(examCandidate, seats);

    await tx.delete(examPin, eq(examPin.examId, examId));
    if (e.pinRequired) {
      await tx.insert(
        examPin,
        seats.map((s) => {
          const pin = generateExamPin();
          return { examId, studentId: s.studentId, pinHash: hashExamPin(examId, s.studentId, pin), pinSealed: sealPin(pin) };
        }),
      );
    }

    await tx.update(exam, { status: "scheduled", publishedAt: now, totalMarks: Math.round(total) }, eq(exam.id, examId));
    await tx.query((db) =>
      audit(db, { schoolId: tx.schoolId, actorUserId: actor.id, action: "exam.publish", entityType: "exam", entityId: examId, meta: { questions: rows.length, candidates: seats.length } }),
    );
    return { questions: rows.length, candidates: seats.length, pins: e.pinRequired ? seats.length : 0 };
  });
}

/** Back to draft, only while nobody has started. */
export async function unpublishExam(scope: TenantScope, actor: Actor, examId: string) {
  const e = await loadExamForEdit(scope, actor, examId);
  if (e.status === "draft") return;
  const started = await scope.findFirst(attempt, eq(attempt.examId, examId));
  if (started) throw new ExamError("Students have already started this exam, so it can't be unpublished.");
  await scope.transaction(async (tx) => {
    await tx.delete(examQuestion, eq(examQuestion.examId, examId));
    await tx.delete(examPin, eq(examPin.examId, examId));
    await tx.delete(examCandidate, eq(examCandidate.examId, examId));
    await tx.update(exam, { status: "draft", publishedAt: null }, eq(exam.id, examId));
    await tx.query((db) => audit(db, { schoolId: tx.schoolId, actorUserId: actor.id, action: "exam.unpublish", entityType: "exam", entityId: examId }));
  });
  await recount(scope, examId);
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export async function listExams(scope: TenantScope, actor: Actor, now = new Date()) {
  const rows = await scope.query((db, owns) =>
    db
      .select({ exam, candidates: sql<number>`(select count(*)::int from ${examCandidate} where ${examCandidate.examId} = ${exam.id})` })
      .from(exam)
      .where(owns(exam))
      .orderBy(asc(exam.windowStart)),
  );
  const ids = rows.map((r) => r.exam.id);
  const [subs, arms] = ids.length
    ? await Promise.all([
        scope.query((db, owns) =>
          db
            .select({ examId: examSubject.examId, name: subject.name, departmentId: subject.departmentId })
            .from(examSubject)
            .innerJoin(subject, owns(subject, eq(subject.id, examSubject.subjectId)))
            .where(owns(examSubject, inArray(examSubject.examId, ids))),
        ),
        scope.query((db, owns) =>
          db
            .select({ examId: examAssignment.examId, name: classArm.name })
            .from(examAssignment)
            .innerJoin(classArm, owns(classArm, eq(classArm.id, examAssignment.classArmId)))
            .where(owns(examAssignment, inArray(examAssignment.examId, ids))),
        ),
      ])
    : [[], []];
  return rows
    .map(({ exam: e, candidates }) => {
      const mySubs = subs.filter((s) => s.examId === e.id);
      const depts = new Set(mySubs.map((s) => s.departmentId));
      return {
        ...e,
        phase: examPhaseStatus(e, now),
        subjects: mySubs.map((s) => s.name),
        classes: arms.filter((a) => a.examId === e.id).map((a) => a.name).sort(),
        candidates,
        departmentId: depts.size === 1 ? [...depts][0] : null,
      };
    })
    .filter((e) => can(actor, "exam.manage", { schoolId: scope.schoolId, departmentId: e.departmentId }));
}

export async function getBuilder(scope: TenantScope, actor: Actor, examId: string) {
  const e = await loadExamForEdit(scope, actor, examId);
  const [subjects, arms, sections, items, rules] = await Promise.all([
    scope.findMany(examSubject, eq(examSubject.examId, examId)),
    scope.query((db, owns) =>
      db
        .select({ a: examAssignment, name: classArm.name, levelId: classArm.classLevelId })
        .from(examAssignment)
        .innerJoin(classArm, owns(classArm, eq(classArm.id, examAssignment.classArmId)))
        .where(owns(examAssignment, eq(examAssignment.examId, examId))),
    ),
    scope.findMany(examSection, eq(examSection.examId, examId)),
    scope.query((db, owns) =>
      db
        .select({
          id: examSectionItem.id,
          sectionId: examSectionItem.sectionId,
          sortOrder: examSectionItem.sortOrder,
          marks: examSectionItem.marks,
          questionId: question.id,
          number: question.number,
          type: question.type,
          stemText: question.stemText,
          qMarks: question.marks,
          status: question.status,
          difficulty: question.difficulty,
          passageId: question.passageId,
          subjectName: subject.name,
          subjectCode: subject.code,
        })
        .from(examSectionItem)
        .innerJoin(question, owns(question, eq(question.id, examSectionItem.questionId)))
        .innerJoin(subject, owns(subject, eq(subject.id, question.subjectId)))
        .where(owns(examSectionItem, eq(examSectionItem.examId, examId))),
    ),
    scope.query((db, owns) =>
      db
        .select({ r: examDrawRule, topicName: topic.name, levelCode: classLevel.code, subjectName: subject.name })
        .from(examDrawRule)
        .innerJoin(subject, owns(subject, eq(subject.id, examDrawRule.subjectId)))
        .leftJoin(topic, owns(topic, eq(topic.id, examDrawRule.topicId)))
        .leftJoin(classLevel, owns(classLevel, eq(classLevel.id, examDrawRule.classLevelId)))
        .where(owns(examDrawRule, eq(examDrawRule.examId, examId))),
    ),
  ]);
  return {
    exam: e,
    subjectIds: subjects.sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.subjectId),
    classes: arms.map((a) => ({ classArmId: a.a.classArmId, name: a.name, classLevelId: a.levelId, venue: a.a.venue, invigilatorId: a.a.invigilatorId })).sort((a, b) => a.name.localeCompare(b.name)),
    sections: sections
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({
        ...s,
        items: items
          .filter((i) => i.sectionId === s.id)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((i) => ({ ...i, code: questionCode(i.subjectName, i.subjectCode, i.number), effectiveMarks: i.marks ?? i.qMarks })),
        rules: rules.filter((r) => r.r.sectionId === s.id).map((r) => ({ ...r.r, topicName: r.topicName, levelCode: r.levelCode, subjectName: r.subjectName })),
      })),
  };
}

/** Approved questions for the picker, not already in this exam. */
export async function pickerQuestions(
  scope: TenantScope,
  examId: string,
  f: { subjectId: string; classLevelId?: string | null; topicId?: string | null; q?: string },
) {
  return scope.query((db, owns) =>
    db
      .select({
        id: question.id,
        number: question.number,
        type: question.type,
        stemText: question.stemText,
        marks: question.marks,
        difficulty: question.difficulty,
        passageId: question.passageId,
        passageTitle: passage.title,
        topicName: topic.name,
        subjectName: subject.name,
        subjectCode: subject.code,
      })
      .from(question)
      .innerJoin(subject, owns(subject, eq(subject.id, question.subjectId)))
      .leftJoin(topic, owns(topic, eq(topic.id, question.topicId)))
      .leftJoin(passage, owns(passage, eq(passage.id, question.passageId)))
      .where(
        owns(
          question,
          and(
            eq(question.subjectId, f.subjectId),
            eq(question.status, "approved"),
            f.classLevelId ? eq(question.classLevelId, f.classLevelId) : undefined,
            f.topicId ? eq(question.topicId, f.topicId) : undefined,
            f.q ? sql`${question.stemText} ilike ${`%${f.q.replace(/[%_]/g, "")}%`}` : undefined,
            sql`${question.id} not in (select ${examSectionItem.questionId} from ${examSectionItem} where ${examSectionItem.examId} = ${examId})`,
          ),
        ),
      )
      .orderBy(asc(question.passageId), asc(question.number))
      .limit(200),
  );
}

export type Slip = { studentId: string; name: string; admissionNo: string; seat: string | null; className: string; venue: string | null; pin: string | null };

/** Exam slips (and PINs, when the exam uses them) for printing, per class. */
export async function examSlips(scope: TenantScope, actor: Actor, examId: string): Promise<{ exam: ExamRow; classes: { classArmId: string; name: string; venue: string | null; slips: Slip[] }[] }> {
  const e = await loadExamForEdit(scope, actor, examId);
  if (e.status === "draft") throw new ExamError("Publish the exam to print slips.");
  const [rows, pins, arms] = await Promise.all([
    scope.query((db, owns) =>
      db
        .select({ c: examCandidate, s: student, armName: classArm.name })
        .from(examCandidate)
        .innerJoin(student, owns(student, eq(student.id, examCandidate.studentId)))
        .innerJoin(classArm, owns(classArm, eq(classArm.id, student.classArmId)))
        .where(owns(examCandidate, eq(examCandidate.examId, examId))),
    ),
    scope.findMany(examPin, eq(examPin.examId, examId)),
    scope.query((db, owns) =>
      db
        .select({ a: examAssignment, name: classArm.name })
        .from(examAssignment)
        .innerJoin(classArm, owns(classArm, eq(classArm.id, examAssignment.classArmId)))
        .where(owns(examAssignment, eq(examAssignment.examId, examId))),
    ),
  ]);
  const pinOf = new Map(pins.map((p) => [p.studentId, p.pinSealed]));
  await scope.query((db) => audit(db, { schoolId: scope.schoolId, actorUserId: actor.id, action: "exam.slips", entityType: "exam", entityId: examId }));
  return {
    exam: e,
    classes: arms
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({
        classArmId: a.a.classArmId,
        name: a.name,
        venue: a.a.venue ?? e.venue,
        slips: rows
          .filter((r) => r.s.classArmId === a.a.classArmId)
          .sort((x, y) => (x.c.seat ?? "").localeCompare(y.c.seat ?? ""))
          .map((r) => ({
            studentId: r.s.id,
            name: `${r.s.firstName} ${r.s.lastName}`,
            admissionNo: r.s.admissionNo,
            seat: r.c.seat,
            className: r.armName,
            venue: a.a.venue ?? e.venue,
            pin: pinOf.has(r.s.id) ? unsealPin(pinOf.get(r.s.id)!) : null,
          })),
      })),
  };
}

/** Deletes a draft that nobody has sat. */
export async function deleteDraft(scope: TenantScope, actor: Actor, examId: string) {
  await editableDraft(scope, actor, examId);
  await scope.delete(exam, and(eq(exam.id, examId), eq(exam.status, "draft"), ne(exam.status, "closed"))!);
}

// ─── Preview ─────────────────────────────────────────────────────────────────

/**
 * The exam screen as a student would see it, for staff to try. Published:
 * the frozen questions. Draft: the picked questions plus a sample random draw.
 * Nothing is saved: the page runs in preview mode.
 */
export async function previewPayload(
  scope: TenantScope,
  actor: Actor,
  examId: string,
  ctx: { schoolName: string; logoUrl: string | null; slug: string },
  now = new Date(),
): Promise<RuntimePayload> {
  const e = await loadExamForEdit(scope, actor, examId);
  const sections = (await scope.findMany(examSection, eq(examSection.examId, examId))).sort((a, b) => a.sortOrder - b.sortOrder);
  let rows: { id: string; sectionId: string; marks: number; sortOrder: number; snapshot: ExamQuestionSnapshot }[];
  if (e.status !== "draft") {
    rows = await scope.findMany(examQuestion, eq(examQuestion.examId, examId));
  } else {
    const items = await scope.findMany(examSectionItem, eq(examSectionItem.examId, examId));
    const rules = await scope.findMany(examDrawRule, eq(examDrawRule.examId, examId));
    const rand = seededRandom(`${examId}:${now.getTime()}`);
    const chosen: { sectionId: string; questionId: string; marks: number | null; order: number }[] = [];
    let order = 0;
    for (const s of sections) {
      for (const it of items.filter((i) => i.sectionId === s.id).sort((a, b) => a.sortOrder - b.sortOrder)) chosen.push({ sectionId: s.id, questionId: it.questionId, marks: it.marks, order: ++order });
      for (const r of rules.filter((x) => x.sectionId === s.id)) {
        for (const d of shuffle(await drawPool(scope, examId, r), rand).slice(0, r.count)) chosen.push({ sectionId: s.id, questionId: d.id, marks: r.marksEach, order: ++order });
      }
    }
    const snaps = await snapshots(scope, chosen.map((c) => c.questionId));
    const bankMarks = new Map((chosen.length ? await scope.findMany(question, inArray(question.id, chosen.map((c) => c.questionId))) : []).map((q) => [q.id, q.marks]));
    rows = chosen
      .filter((c) => snaps.has(c.questionId))
      .map((c) => ({ id: `preview-${c.order}`, sectionId: c.sectionId, marks: c.marks ?? bankMarks.get(c.questionId) ?? 1, sortOrder: c.order, snapshot: snaps.get(c.questionId)! }));
  }
  const secOrder = new Map(sections.map((s) => [s.id, s.sortOrder]));
  const order = buildOrder(
    rows.map((r) => ({ id: r.id, sectionOrder: secOrder.get(r.sectionId) ?? 0, sortOrder: r.sortOrder, passageId: r.snapshot.passage?.id ?? null, type: r.snapshot.type, optionIds: r.snapshot.type === "true_false" ? [] : r.snapshot.options.map((o) => o.id) })),
    { shuffleQuestions: e.shuffleQuestions, shuffleOptions: e.shuffleOptions },
    `preview:${now.getTime()}`,
  );
  const { questions, passages } = renderQuestions(rows, sections, order.questionOrder, order.optionOrder);
  return {
    attemptId: `preview-${examId}`,
    syncUrl: "",
    homeUrl: `/s/${ctx.slug}/exams/${examId}?step=preview`,
    loginUrl: `/login`,
    school: { name: ctx.schoolName, logoUrl: ctx.logoUrl },
    exam: { title: e.title, series: e.series, fullTitle: e.fullTitle, calculator: e.calculator, integrity: e.integritySettings ?? PRESETS[e.integrity] },
    student: { name: "Preview Student", firstName: "Preview", admissionNo: "PREVIEW", className: null, photoUrl: null },
    sections: sections.map((s) => ({ title: s.title })),
    questions,
    passages,
    answers: {},
    currentIndex: 0,
    clientSeq: 0,
    eventSeq: 0,
    deadlineAt: now.getTime() + e.durationMinutes * 60_000,
    serverNow: now.getTime(),
  };
}
