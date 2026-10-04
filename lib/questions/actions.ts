"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { storeUpload, UploadError } from "@/lib/storage";
import { requireCan } from "@/lib/tenant/context";
import type { QuestionInput } from "./model";
import {
  applyWorkflow,
  bulkUpdate,
  deleteDraft,
  getPassage,
  QuestionError,
  savePassage,
  saveQuestion,
  type SaveResult,
  type WorkflowAction,
} from "./service";

const doc = z.object({ type: z.literal("doc"), content: z.array(z.unknown()).optional() });

const inputSchema = z.object({
  type: z.enum(["mcq_single", "mcq_multi", "true_false", "fill_blank", "numeric", "theory"]),
  subjectId: z.string(),
  classLevelId: z.string().nullable(),
  topicName: z.string().max(80),
  passageId: z.string().nullable(),
  stem: doc,
  marks: z.number(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  options: z.array(z.object({ content: doc, isCorrect: z.boolean() })).max(10),
  scoring: z.enum(["all_or_nothing", "partial"]),
  trueFalse: z.boolean().nullable(),
  accepted: z.array(z.string().max(200)).max(20),
  caseSensitive: z.boolean(),
  numericValue: z.string().max(40),
  tolerance: z.string().max(40),
  markingGuide: doc.nullable(),
});

export async function saveQuestionAction(
  slug: string,
  args: { id?: string; input: QuestionInput; submit: boolean; allowDuplicate?: boolean },
): Promise<SaveResult> {
  const ctx = await requireCan(slug, "question.create");
  const parsed = inputSchema.safeParse(args.input);
  if (!parsed.success) return { ok: false, errors: ["Something in the form isn't in the expected shape. Reload and try again."] };
  try {
    const res = await saveQuestion(ctx.scope, ctx.actor, { ...args, input: parsed.data as QuestionInput });
    if (res.ok) revalidatePath(`/s/${slug}/questions`);
    return res;
  } catch (e) {
    if (e instanceof QuestionError) return { ok: false, errors: [e.message] };
    throw e;
  }
}

export async function workflowAction(
  slug: string,
  ids: string[],
  action: WorkflowAction,
  comment?: string,
): Promise<{ changed?: number; skipped?: number; error?: string }> {
  const ctx = await requireCan(slug, "question.create");
  try {
    const r = await applyWorkflow(ctx.scope, ctx.actor, z.array(z.uuid()).max(500).parse(ids), action, comment);
    revalidatePath(`/s/${slug}/questions`);
    return r;
  } catch (e) {
    if (e instanceof QuestionError) return { error: e.message };
    throw e;
  }
}

export async function bulkUpdateAction(
  slug: string,
  ids: string[],
  patch: { topicName?: string; classLevelId?: string | null },
): Promise<{ changed: number }> {
  const ctx = await requireCan(slug, "question.create");
  const r = await bulkUpdate(ctx.scope, ctx.actor, z.array(z.uuid()).max(500).parse(ids), patch);
  revalidatePath(`/s/${slug}/questions`);
  return r;
}

export async function deleteDraftAction(slug: string, id: string): Promise<{ error?: string }> {
  const ctx = await requireCan(slug, "question.create");
  try {
    await deleteDraft(ctx.scope, ctx.actor, id);
    revalidatePath(`/s/${slug}/questions`);
    return {};
  } catch (e) {
    if (e instanceof QuestionError) return { error: e.message };
    throw e;
  }
}

export async function uploadQuestionImageAction(slug: string, form: FormData): Promise<{ url?: string; error?: string }> {
  const ctx = await requireCan(slug, "question.create");
  const file = form.get("file");
  if (!(file instanceof File)) return { error: "Choose an image." };
  try {
    return { url: await storeUpload(ctx.school.id, "question", file) };
  } catch (e) {
    if (e instanceof UploadError) return { error: e.message };
    throw e;
  }
}

export async function savePassageAction(
  slug: string,
  args: { id?: string; subjectId: string; classLevelId: string | null; title: string; content: z.infer<typeof doc> },
): Promise<{ id?: string; title?: string; error?: string }> {
  const ctx = await requireCan(slug, "question.create");
  try {
    const row = await savePassage(ctx.scope, ctx.actor, { ...args, content: doc.parse(args.content) as never });
    revalidatePath(`/s/${slug}/questions`);
    return { id: row.id, title: row.title };
  } catch (e) {
    if (e instanceof QuestionError) return { error: e.message };
    throw e;
  }
}

export async function getPassageAction(slug: string, id: string) {
  const ctx = await requireCan(slug, "question.create");
  const p = await getPassage(ctx.scope, id);
  return p ? { id: p.id, title: p.title, content: p.content } : null;
}
