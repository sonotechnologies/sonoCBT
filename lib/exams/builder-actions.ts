"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { IntegritySettings } from "@/lib/db/schema";
import { fromLagos } from "@/lib/format";
import { requireStaff } from "@/lib/tenant/context";
import * as b from "./builder";

type Result = { error?: string };

async function run<T>(slug: string, examId: string | null, fn: (ctx: Awaited<ReturnType<typeof requireStaff>>) => Promise<T>): Promise<T | { error: string }> {
  const ctx = await requireStaff(slug);
  try {
    const out = await fn(ctx);
    revalidatePath(`/s/${slug}/exams`);
    if (examId) revalidatePath(`/s/${slug}/exams/${examId}`);
    return out;
  } catch (e) {
    if (e instanceof b.ExamError) return { error: e.message };
    throw e;
  }
}

const details = z.object({
  title: z.string().trim().min(1, "Give the exam a title.").max(120),
  fullTitle: z.string().trim().max(200).nullable().optional(),
  series: z.string().trim().max(120).nullable().optional(),
  type: z.enum(["ca_test", "exam", "mock", "entrance", "practice"]),
  termId: z.uuid("Choose a term."),
  subjectIds: z.array(z.uuid()).min(1, "Choose at least one subject.").max(12),
  classArmIds: z.array(z.uuid()).min(1, "Choose at least one class.").max(60),
  durationMinutes: z.coerce.number().int().min(5, "Duration must be at least 5 minutes.").max(360, "Duration can't be more than 6 hours."),
  instructions: z.string().trim().max(4000).nullable().optional(),
  calculator: z.enum(["off", "basic", "scientific"]),
  componentId: z.uuid().nullable().optional(),
  aiMarking: z.boolean().optional(),
});

function parseDetails(input: unknown): b.DetailsInput | string {
  const p = details.safeParse(input);
  return p.success ? (p.data as b.DetailsInput) : p.error.issues[0].message;
}

export async function createExamAction(slug: string, input: unknown): Promise<{ id?: string; error?: string }> {
  const d = parseDetails(input);
  if (typeof d === "string") return { error: d };
  const r = await run(slug, null, (ctx) => b.createExam(ctx.scope, ctx.actor, d));
  return typeof r === "string" ? { id: r } : r;
}

export async function saveDetailsAction(slug: string, examId: string, input: unknown): Promise<Result> {
  const d = parseDetails(input);
  if (typeof d === "string") return { error: d };
  const r = await run(slug, examId, (ctx) => b.saveDetails(ctx.scope, ctx.actor, examId, d));
  return r ?? {};
}

export async function saveSectionAction(slug: string, examId: string, s: { id?: string; title: string; subjectId: string | null }): Promise<Result> {
  const r = await run(slug, examId, (ctx) => b.saveSection(ctx.scope, ctx.actor, examId, { id: s.id, title: String(s.title).slice(0, 80), subjectId: s.subjectId || null }));
  return typeof r === "string" ? {} : r;
}

export async function deleteSectionAction(slug: string, examId: string, sectionId: string): Promise<Result> {
  return (await run(slug, examId, (ctx) => b.deleteSection(ctx.scope, ctx.actor, examId, sectionId))) ?? {};
}

export async function moveSectionAction(slug: string, examId: string, sectionId: string, dir: -1 | 1): Promise<Result> {
  return (await run(slug, examId, (ctx) => b.moveSection(ctx.scope, ctx.actor, examId, sectionId, dir === -1 ? -1 : 1))) ?? {};
}

export async function pickerAction(slug: string, examId: string, f: { subjectId: string; classLevelId?: string | null; topicId?: string | null; q?: string }) {
  const ctx = await requireStaff(slug);
  await b.loadExamForEdit(ctx.scope, ctx.actor, examId);
  return b.pickerQuestions(ctx.scope, examId, { subjectId: f.subjectId, classLevelId: f.classLevelId || null, topicId: f.topicId || null, q: f.q?.slice(0, 80) });
}

export async function addQuestionsAction(slug: string, examId: string, sectionId: string, questionIds: string[]): Promise<Result & { added?: number }> {
  const r = await run(slug, examId, (ctx) => b.addQuestions(ctx.scope, ctx.actor, examId, sectionId, questionIds.slice(0, 200)));
  return typeof r === "number" ? { added: r } : r;
}

export async function removeQuestionAction(slug: string, examId: string, itemId: string): Promise<Result> {
  return (await run(slug, examId, (ctx) => b.removeQuestion(ctx.scope, ctx.actor, examId, itemId))) ?? {};
}

export async function setItemMarksAction(slug: string, examId: string, itemId: string, marks: number | null): Promise<Result> {
  return (await run(slug, examId, (ctx) => b.setItemMarks(ctx.scope, ctx.actor, examId, itemId, marks))) ?? {};
}

const rule = z.object({
  subjectId: z.uuid(),
  classLevelId: z.uuid().nullable(),
  topicId: z.uuid().nullable(),
  difficulty: z.enum(["easy", "medium", "hard"]).nullable(),
  count: z.coerce.number().int(),
  marksEach: z.coerce.number(),
});

export async function countPoolAction(slug: string, examId: string, input: unknown): Promise<number> {
  const p = rule.safeParse(input);
  if (!p.success) return 0;
  const ctx = await requireStaff(slug);
  await b.loadExamForEdit(ctx.scope, ctx.actor, examId);
  return b.countDrawPool(ctx.scope, examId, p.data);
}

export async function addDrawRuleAction(slug: string, examId: string, sectionId: string, input: unknown): Promise<Result> {
  const p = rule.safeParse(input);
  if (!p.success) return { error: "Check the rule." };
  return (await run(slug, examId, (ctx) => b.addDrawRule(ctx.scope, ctx.actor, examId, sectionId, p.data))) ?? {};
}

export async function removeDrawRuleAction(slug: string, examId: string, ruleId: string): Promise<Result> {
  return (await run(slug, examId, (ctx) => b.removeDrawRule(ctx.scope, ctx.actor, examId, ruleId))) ?? {};
}

const settings = z.object({
  integrity: z.enum(["practice", "standard", "strict"]),
  integritySettings: z.object({
    fullscreen: z.enum(["off", "prompt", "required"]),
    logTabSwitches: z.boolean(),
    warnOnLeave: z.boolean(),
    blockCopy: z.boolean(),
    oneDevice: z.boolean(),
    submitAfterLeaves: z.number().int().nullable(),
    snapshot: z.boolean(),
    allowedIps: z.array(z.string().max(60)).max(20).optional(),
  }),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  showScoreAfterSubmit: z.boolean(),
  calculator: z.enum(["off", "basic", "scientific"]),
  pinRequired: z.boolean(),
});

export async function saveSettingsAction(slug: string, examId: string, input: unknown): Promise<Result> {
  const p = settings.safeParse(input);
  if (!p.success) return { error: "Check the settings." };
  return (await run(slug, examId, (ctx) => b.saveSettings(ctx.scope, ctx.actor, examId, { ...p.data, integritySettings: p.data.integritySettings as IntegritySettings }))) ?? {};
}

const schedule = z.object({
  date: z.string(),
  opens: z.string(),
  lateUntil: z.string(),
  venue: z.string().max(80).nullable(),
  rooms: z.array(z.object({ classArmId: z.uuid(), venue: z.string().max(80).nullable(), invigilatorId: z.uuid().nullable() })).max(60),
});

export async function saveScheduleAction(slug: string, examId: string, input: unknown): Promise<Result> {
  const p = schedule.safeParse(input);
  if (!p.success) return { error: "Check the date and times." };
  const start = fromLagos(p.data.date, p.data.opens);
  if (!start) return { error: "Choose a date and an opening time." };
  const late = p.data.lateUntil ? fromLagos(p.data.date, p.data.lateUntil) : null;
  if (p.data.lateUntil && !late) return { error: "Late entry time isn't right." };
  return (await run(slug, examId, (ctx) => b.saveSchedule(ctx.scope, ctx.actor, examId, { windowStart: start, lateEntryUntil: late, venue: p.data.venue, rooms: p.data.rooms }))) ?? {};
}

export async function publishAction(slug: string, examId: string): Promise<Result & { questions?: number; candidates?: number }> {
  const r = await run(slug, examId, (ctx) => b.publishExam(ctx.scope, ctx.actor, examId));
  return "error" in r ? r : r;
}

export async function unpublishAction(slug: string, examId: string): Promise<Result> {
  return (await run(slug, examId, (ctx) => b.unpublishExam(ctx.scope, ctx.actor, examId))) ?? {};
}

export async function deleteDraftAction(slug: string, examId: string): Promise<Result> {
  return (await run(slug, examId, (ctx) => b.deleteDraft(ctx.scope, ctx.actor, examId))) ?? {};
}
