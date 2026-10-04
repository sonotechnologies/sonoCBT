import { featureBlock } from "@/lib/billing/gate";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can, type Actor } from "@/lib/auth/permissions";
import { classLevel, importJob, question, subject } from "@/lib/db/schema";
import { findDuplicates, questionCode } from "@/lib/questions/model";
import { docToText, validateDoc } from "@/lib/questions/rich";
import { addQuestions, savePassage } from "@/lib/questions/service";
import type { TenantScope } from "@/lib/tenant/scope";
import { assess, toInput, type ParsedItem, type ParsedPassage } from "./items";

export class ImportError extends Error {}

type Kind = (typeof importJob.$inferSelect)["kind"];
const SOURCE: Record<Kind, (typeof question.$inferSelect)["source"]> = { word: "word", photo: "photo", sheet: "sheet", ai: "ai" };

export type ImportJob = Omit<typeof importJob.$inferSelect, "items" | "passages"> & { items: ParsedItem[]; passages: ParsedPassage[] };

/** Adds an amber flag to items that look like questions already in the bank. */
async function flagDuplicates(scope: TenantScope, subjectId: string, items: ParsedItem[]) {
  const [subj, existing] = await Promise.all([
    scope.findFirst(subject, eq(subject.id, subjectId)),
    scope.query((db, owns) =>
      db
        .select({ id: question.id, number: question.number, text: question.stemText })
        .from(question)
        .where(owns(question, and(eq(question.subjectId, subjectId), ne(question.status, "archived")))),
    ),
  ]);
  if (!existing.length) return;
  for (const it of items) {
    const [dupe] = findDuplicates(docToText(it.stem), existing);
    if (dupe) it.flags.push({ level: "amber", message: `Looks like ${questionCode(subj?.name ?? "", subj?.code, dupe.number)}, already in the bank.` });
  }
}

export async function createImportJob(
  scope: TenantScope,
  actor: Actor,
  args: {
    kind: Kind;
    title: string;
    subjectId: string;
    classLevelId: string | null;
    items: ParsedItem[];
    passages?: ParsedPassage[];
    sourceHtml?: string | null;
    notes?: string[];
  },
): Promise<string> {
  if (!can(actor, "question.create", { schoolId: scope.schoolId })) throw new ImportError("You can't import questions.");
  if (!(await scope.findFirst(subject, eq(subject.id, args.subjectId)))) throw new ImportError("Choose a subject.");
  const blocked = await featureBlock(scope, args.kind === "photo" ? "photo_import" : args.kind === "ai" ? "ai_assistant" : "smart_import");
  if (blocked) throw new ImportError(blocked);
  if (args.classLevelId && !(await scope.findFirst(classLevel, eq(classLevel.id, args.classLevelId)))) throw new ImportError("Choose a class.");
  if (!args.items.length) throw new ImportError("No questions were found. Check the file is a question paper, or try another way to import.");
  await flagDuplicates(scope, args.subjectId, args.items);
  const [job] = await scope.insert(importJob, {
    kind: args.kind,
    title: args.title.slice(0, 200),
    subjectId: args.subjectId,
    classLevelId: args.classLevelId,
    items: args.items,
    passages: args.passages ?? [],
    sourceHtml: args.sourceHtml ?? null,
    notes: args.notes ?? [],
    createdBy: actor.id,
  });
  await scope.query((db) =>
    audit(db, { schoolId: scope.schoolId, actorUserId: actor.id, action: "import.create", entityType: "import_job", entityId: job.id, meta: { kind: args.kind, items: args.items.length } }),
  );
  return job.id;
}

/** The person who started an import, and reviewers (admin / exam officer), can open it. */
function canOpen(actor: Actor, schoolId: string, job: { createdBy: string | null }) {
  return job.createdBy === actor.id || can(actor, "question.approve", { schoolId });
}

export async function getImportJob(scope: TenantScope, actor: Actor, id: string): Promise<ImportJob | null> {
  const job = await scope.findFirst(importJob, eq(importJob.id, id));
  if (!job || !canOpen(actor, scope.schoolId, job)) return null;
  return job as unknown as ImportJob;
}

export async function listImportJobs(scope: TenantScope, actor: Actor) {
  const jobs = await scope.query((db, owns) =>
    db
      .select({
        id: importJob.id,
        kind: importJob.kind,
        title: importJob.title,
        status: importJob.status,
        items: importJob.items,
        savedCount: importJob.savedCount,
        createdBy: importJob.createdBy,
        updatedAt: importJob.updatedAt,
        subjectName: subject.name,
      })
      .from(importJob)
      .innerJoin(subject, owns(subject, eq(subject.id, importJob.subjectId)))
      .where(owns(importJob, ne(importJob.status, "discarded")))
      .orderBy(desc(importJob.updatedAt))
      .limit(30),
  );
  return jobs
    .filter((j) => canOpen(actor, scope.schoolId, j))
    .map((j) => ({
      id: j.id,
      kind: j.kind,
      title: j.title,
      status: j.status,
      savedCount: j.savedCount,
      updatedAt: j.updatedAt,
      subjectName: j.subjectName,
      total: (j.items as ParsedItem[]).filter((i) => i.status !== "skipped").length,
    }));
}

// ─── Saving review edits ─────────────────────────────────────────────────────

const doc = z.object({ type: z.literal("doc"), content: z.array(z.unknown()).optional() });
const zItem = z.object({
  id: z.string().max(40),
  number: z.number().int().nullable(),
  type: z.enum(["mcq_single", "mcq_multi", "true_false", "fill_blank", "numeric", "theory"]),
  stem: doc,
  options: z.array(z.object({ content: doc, isCorrect: z.boolean() })).max(8),
  accepted: z.array(z.string().max(200)).max(20),
  trueFalse: z.boolean().nullable(),
  numericValue: z.string().max(40),
  markingGuide: doc.nullable(),
  explanation: z.string().max(2000).nullable(),
  marks: z.number().min(0).max(100),
  topicName: z.string().max(80),
  difficulty: z.enum(["easy", "medium", "hard"]),
  passageKey: z.string().max(40).nullable(),
  flags: z.array(z.object({ level: z.enum(["amber", "red"]), message: z.string().max(300) })).max(10),
  source: z.number().int().nullable(),
  status: z.enum(["review", "accepted", "skipped", "saved"]),
  questionId: z.string().optional(),
});

export async function updateImportItems(scope: TenantScope, actor: Actor, id: string, items: unknown) {
  const job = await getImportJob(scope, actor, id);
  if (!job) throw new ImportError("Import not found.");
  if (job.status !== "review") throw new ImportError("This import is finished.");
  const parsed = z.array(zItem).max(600).safeParse(items);
  if (!parsed.success) throw new ImportError("Some questions weren't in the expected shape. Reload the page.");
  for (const it of parsed.data) {
    for (const d of [it.stem, it.markingGuide, ...it.options.map((o) => o.content)]) {
      if (d && validateDoc(d)) throw new ImportError(validateDoc(d)!);
    }
  }
  // Saved questions can't be changed or un-saved from here.
  const saved = new Map(job.items.filter((i) => i.status === "saved").map((i) => [i.id, i]));
  const merged = (parsed.data as ParsedItem[]).map((i) => saved.get(i.id) ?? (i.status === "saved" ? { ...i, status: "review" as const } : i));
  await scope.update(importJob, { items: merged }, eq(importJob.id, id));
}

/**
 * Adds accepted questions to the bank (as drafts, or sent for approval).
 * Passages are created once and linked. A question that fails its checks is
 * reported and the rest still save; the whole commit (questions, passages and
 * the job's record of them) is one transaction, so an interrupted commit
 * leaves nothing half-saved and can simply be run again.
 */
export async function commitImport(scope: TenantScope, actor: Actor, id: string, submit: boolean) {
  return scope.transaction(async (tx) => {
    const job = await getImportJob(tx, actor, id);
    if (!job) throw new ImportError("Import not found.");
    const items = job.items;
    const passages = job.passages.map((p) => ({ ...p }));
    const failed: { id: string; error: string }[] = [];
    const accepted = items.filter((i) => i.status === "accepted");

    // Passages first (a paper has only a few), then every question in one batch.
    for (const passage of passages) {
      if (passage.questionId || !accepted.some((i) => i.passageKey === passage.key)) continue;
      const row = await savePassage(tx, actor, { subjectId: job.subjectId, classLevelId: job.classLevelId, title: passage.title, content: passage.content });
      passage.questionId = row.id;
    }
    const passageId = (key: string | null) => (key ? (passages.find((p) => p.key === key)?.questionId ?? null) : null);
    const results = await addQuestions(tx, actor, {
      subjectId: job.subjectId,
      submit,
      source: SOURCE[job.kind],
      items: accepted.map((it) => ({ input: toInput(it, job.subjectId, job.classLevelId, passageId(it.passageKey)), explanation: it.explanation })),
    });
    let saved = 0;
    accepted.forEach((it, i) => {
      const res = results[i];
      if (res.ok) {
        it.status = "saved";
        it.questionId = res.id;
        saved++;
      } else failed.push({ id: it.id, error: "errors" in res ? res.errors.join(" ") : "Duplicate" });
    });

    const remaining = items.filter((i) => i.status === "review" || i.status === "accepted").length;
    await tx.update(
      importJob,
      { items, passages, savedCount: job.savedCount + saved, status: remaining ? "review" : "saved" },
      eq(importJob.id, id),
    );
    await tx.query((db) =>
      audit(db, { schoolId: tx.schoolId, actorUserId: actor.id, action: "import.commit", entityType: "import_job", entityId: id, meta: { saved, failed: failed.length, submit } }),
    );
    return { saved, failed, items };
  });
}

export async function discardImport(scope: TenantScope, actor: Actor, id: string) {
  const job = await getImportJob(scope, actor, id);
  if (!job) throw new ImportError("Import not found.");
  await scope.update(importJob, { status: "discarded" }, eq(importJob.id, id));
}

/** Items the review screen can accept in one go. */
export function greenIds(items: ParsedItem[]) {
  return items.filter((i) => i.status === "review" && assess(i).confidence === "green").map((i) => i.id);
}
