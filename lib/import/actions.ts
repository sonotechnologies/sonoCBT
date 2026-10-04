"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AiError, runAi } from "@/lib/ai";
import { generateQuestions, readQuestionPhotos, suggestTags } from "@/lib/ai/questions";
import { classLevel, subject, topic } from "@/lib/db/schema";
import { storeBytes, UploadError } from "@/lib/storage";
import { requireCan, type TenantContext } from "@/lib/tenant/context";
import { FileReadError, readSpreadsheet } from "./read-file";
import { DocxError, readDocx } from "./docx";
import { docToText } from "@/lib/questions/rich";
import type { ParsedItem } from "./items";
import { commitImport, createImportJob, discardImport, getImportJob, ImportError, updateImportItems } from "./service";
import { readQuestionSheet } from "./sheet";
import { simpleToItem } from "./simple";
import { parseQuestionPaper } from "./word-parser";

export type ImportState = { error?: string } | undefined;

async function target(ctx: TenantContext, form: FormData) {
  const subjectId = String(form.get("subjectId") ?? "");
  const classLevelId = String(form.get("classLevelId") ?? "") || null;
  const subj = subjectId ? await ctx.scope.findFirst(subject, eq(subject.id, subjectId)) : undefined;
  if (!subj) throw new ImportError("Choose a subject.");
  const level = classLevelId ? await ctx.scope.findFirst(classLevel, eq(classLevel.id, classLevelId)) : undefined;
  if (classLevelId && !level) throw new ImportError("Choose a class.");
  return { subjectId: subj.id, subjectName: subj.name, classLevelId: level?.id ?? null, classLevelCode: level?.code ?? null };
}

function fail(e: unknown): ImportState {
  if (e instanceof ImportError || e instanceof DocxError || e instanceof FileReadError || e instanceof UploadError || e instanceof AiError) {
    return { error: e.message };
  }
  throw e;
}

export async function importWordAction(slug: string, _: ImportState, form: FormData): Promise<ImportState> {
  const ctx = await requireCan(slug, "question.create");
  let id: string;
  try {
    const t = await target(ctx, form);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return { error: "Choose a Word file." };
    if (!/\.docx$/i.test(file.name)) {
      return { error: /\.doc$/i.test(file.name) ? "That's an old Word format (.doc). In Word, choose Save As → Word Document (.docx), then upload again." : "Choose a Word (.docx) file." };
    }
    const { blocks, html } = await readDocx(Buffer.from(await file.arrayBuffer()), (bytes, type) => storeBytes(ctx.school.id, "question", bytes, type));
    const parsed = parseQuestionPaper(blocks);
    id = await createImportJob(ctx.scope, ctx.actor, { kind: "word", title: file.name, ...t, items: parsed.items, passages: parsed.passages, sourceHtml: html, notes: parsed.notes });
  } catch (e) {
    return fail(e);
  }
  redirect(`/s/${slug}/import/${id}`);
}

export async function importSheetAction(slug: string, _: ImportState, form: FormData): Promise<ImportState> {
  const ctx = await requireCan(slug, "question.create");
  let id: string;
  try {
    const t = await target(ctx, form);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return { error: "Choose an Excel or CSV file." };
    const { items, missingColumns } = readQuestionSheet(await readSpreadsheet(file));
    if (missingColumns.length) return { error: `We couldn't find a "${missingColumns[0]}" column. Start from the template.` };
    id = await createImportJob(ctx.scope, ctx.actor, { kind: "sheet", title: file.name, ...t, items });
  } catch (e) {
    return fail(e);
  }
  redirect(`/s/${slug}/import/${id}`);
}

const MAX_PHOTOS = 10;

export async function importPhotosAction(slug: string, _: ImportState, form: FormData): Promise<ImportState> {
  const ctx = await requireCan(slug, "question.create");
  let id: string;
  try {
    const t = await target(ctx, form);
    const photos = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    if (!photos.length) return { error: "Add at least one photo." };
    if (photos.length > MAX_PHOTOS) return { error: `Use up to ${MAX_PHOTOS} photos at a time.` };
    if (photos.some((p) => !/^image\/(jpeg|png|webp)$/.test(p.type))) return { error: "Photos must be JPG, PNG or WebP." };
    const images = await Promise.all(photos.map(async (p) => ({ mimeType: p.type, base64: Buffer.from(await p.arrayBuffer()).toString("base64") })));
    const questions = await runAi(ctx.scope, ctx.user.id, "photoImport", (ai) =>
      readQuestionPhotos(ai, images, { subject: t.subjectName, classLevel: t.classLevelCode }),
    );
    const items = questions.map((q) =>
      simpleToItem(q, [{ level: "amber", message: "Read from a photo. Check the wording and the answer." }]),
    );
    id = await createImportJob(ctx.scope, ctx.actor, {
      kind: "photo",
      title: `${photos.length} photo${photos.length === 1 ? "" : "s"} · ${t.subjectName}`,
      ...t,
      items,
    });
  } catch (e) {
    return fail(e);
  }
  redirect(`/s/${slug}/import/${id}`);
}

const genSchema = z.object({
  topic: z.string().trim().min(2, "Say what topic the questions are on.").max(120),
  count: z.coerce.number().int().min(1).max(30),
  difficulty: z.enum(["easy", "medium", "hard", "mixed"]),
  types: z.array(z.enum(["objective", "true/false", "fill in the gap", "theory"])).min(1, "Choose at least one question type."),
  lessonNote: z.string().max(12_000).optional(),
});

export async function generateAiAction(slug: string, _: ImportState, form: FormData): Promise<ImportState> {
  const ctx = await requireCan(slug, "question.create");
  let id: string;
  try {
    const t = await target(ctx, form);
    if (!t.classLevelCode) return { error: "Choose the class the questions are for." };
    const parsed = genSchema.safeParse({
      topic: form.get("topic"),
      count: form.get("count"),
      difficulty: form.get("difficulty"),
      types: form.getAll("types"),
      lessonNote: String(form.get("lessonNote") ?? "") || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const questions = await runAi(ctx.scope, ctx.user.id, "generate", (ai) =>
      generateQuestions(ai, { subject: t.subjectName, classLevel: t.classLevelCode!, ...parsed.data }),
    );
    const items = questions.map((q, i) =>
      simpleToItem({ ...q, number: i + 1, topic: q.topic || parsed.data.topic }, [
        { level: "amber", message: "Written by AI. Check it's correct and suits your class." },
      ]),
    );
    id = await createImportJob(ctx.scope, ctx.actor, { kind: "ai", title: `AI · ${parsed.data.topic}`, ...t, items });
  } catch (e) {
    return fail(e);
  }
  redirect(`/s/${slug}/import/${id}`);
}

// ─── Review screen ───────────────────────────────────────────────────────────

export async function saveImportItemsAction(slug: string, id: string, items: ParsedItem[]): Promise<{ error?: string }> {
  const ctx = await requireCan(slug, "question.create");
  try {
    await updateImportItems(ctx.scope, ctx.actor, id, items);
    return {};
  } catch (e) {
    return fail(e) ?? {};
  }
}

export async function commitImportAction(slug: string, id: string, items: ParsedItem[], submit: boolean) {
  const ctx = await requireCan(slug, "question.create");
  try {
    await updateImportItems(ctx.scope, ctx.actor, id, items);
    const res = await commitImport(ctx.scope, ctx.actor, id, submit);
    revalidatePath(`/s/${slug}/questions`);
    revalidatePath(`/s/${slug}/import/${id}`);
    return res;
  } catch (e) {
    return { saved: 0, failed: [], items: null, error: fail(e)?.error };
  }
}

export async function discardImportAction(slug: string, id: string) {
  const ctx = await requireCan(slug, "question.create");
  await discardImport(ctx.scope, ctx.actor, id);
  revalidatePath(`/s/${slug}/import`);
  redirect(`/s/${slug}/import`);
}

/** AI topic & difficulty suggestions for the given items (question text only is sent). */
export async function suggestTagsAction(
  slug: string,
  id: string,
  items: ParsedItem[],
): Promise<{ tags?: { id: string; topic: string; difficulty: "easy" | "medium" | "hard" }[]; error?: string }> {
  const ctx = await requireCan(slug, "question.create");
  try {
    const job = await getImportJob(ctx.scope, ctx.actor, id);
    if (!job) return { error: "Import not found." };
    const subj = await ctx.scope.findFirst(subject, eq(subject.id, job.subjectId));
    const level = job.classLevelId ? await ctx.scope.findFirst(classLevel, eq(classLevel.id, job.classLevelId)) : undefined;
    const known = (await ctx.scope.findMany(topic, eq(topic.subjectId, job.subjectId))).map((t) => t.name);
    const wanted = items.filter((i) => i.status !== "saved" && i.status !== "skipped").slice(0, 80);
    if (!wanted.length) return { tags: [] };
    const tags = await runAi(ctx.scope, ctx.user.id, "suggestTags", (ai) =>
      suggestTags(ai, { subject: subj?.name ?? "", classLevel: level?.code ?? null, knownTopics: known }, wanted.map((i) => ({ id: i.id, text: docToText(i.stem) }))),
    );
    return { tags };
  } catch (e) {
    return fail(e) ?? {};
  }
}
