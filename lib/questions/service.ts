import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { can, type Actor } from "@/lib/auth/permissions";
import {
  classLevel,
  passage,
  question,
  questionOption,
  questionStats,
  subject,
  topic,
  user,
  type QuestionAnswer,
  type RichDoc,
} from "@/lib/db/schema";
import type { TenantScope } from "@/lib/tenant/scope";
import { findDuplicates, questionCode, validateQuestion, type QuestionInput, type QuestionType } from "./model";
import { docToText, validateDoc } from "./rich";

export class QuestionError extends Error {}

type Status = (typeof question.$inferSelect)["status"];

// ─── Permissions ─────────────────────────────────────────────────────────────

async function departmentOf(scope: TenantScope, subjectId: string): Promise<string | null> {
  return (await scope.findFirst(subject, eq(subject.id, subjectId)))?.departmentId ?? null;
}

export async function canReview(scope: TenantScope, actor: Actor, subjectId: string): Promise<boolean> {
  return can(actor, "question.approve", { schoolId: scope.schoolId, departmentId: await departmentOf(scope, subjectId) });
}

/** Authors edit their own questions; reviewers edit any in their scope. */
async function canEdit(scope: TenantScope, actor: Actor, q: { authorId: string | null; subjectId: string; status: Status }) {
  if (await canReview(scope, actor, q.subjectId)) return true;
  return q.authorId === actor.id && q.status !== "archived";
}

// ─── Saving ─────────────────────────────────────────────────────────────────

export type SaveResult =
  | { ok: true; id: string; code: string; status: Status }
  | { ok: false; errors: string[] }
  | { ok: false; duplicates: { id: string; code: string; text: string }[] };

async function resolveTopic(scope: TenantScope, subjectId: string, classLevelId: string | null, name: string) {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) return null;
  const existing = await scope.findFirst(
    topic,
    and(
      eq(topic.subjectId, subjectId),
      classLevelId ? eq(topic.classLevelId, classLevelId) : isNull(topic.classLevelId),
      sql`lower(${topic.name}) = ${clean.toLowerCase()}`,
    ),
  );
  if (existing) return existing.id;
  const [row] = await scope.insert(topic, { subjectId, classLevelId, name: clean });
  return row.id;
}

/**
 * Creates or updates a question. `submit` sends it for approval (or approves it
 * straight away when the author is a reviewer for that subject). Near-duplicates
 * in the same subject are reported unless `allowDuplicate`.
 */
export async function saveQuestion(
  scope: TenantScope,
  actor: Actor,
  args: {
    id?: string;
    input: QuestionInput;
    submit: boolean;
    allowDuplicate?: boolean;
    /** How a new question arrived (default: typed in the editor). */
    source?: (typeof question.$inferSelect)["source"];
    explanation?: string | null;
  },
): Promise<SaveResult> {
  const { input } = args;
  if (!can(actor, "question.create", { schoolId: scope.schoolId })) throw new QuestionError("You can't add questions.");
  const v = validateQuestion(input);
  if (!v.ok) return v;

  const subj = await scope.findFirst(subject, eq(subject.id, input.subjectId));
  if (!subj) return { ok: false, errors: ["Choose a subject."] };
  if (input.classLevelId && !(await scope.findFirst(classLevel, eq(classLevel.id, input.classLevelId)))) {
    return { ok: false, errors: ["Choose a class."] };
  }
  if (input.passageId && !(await scope.findFirst(passage, and(eq(passage.id, input.passageId), eq(passage.subjectId, subj.id))))) {
    return { ok: false, errors: ["That passage belongs to another subject."] };
  }

  const existing = args.id ? await scope.findFirst(question, eq(question.id, args.id)) : undefined;
  if (args.id && !existing) throw new QuestionError("Question not found.");
  if (existing && !(await canEdit(scope, actor, existing))) throw new QuestionError("You can only edit your own questions.");

  if (!args.allowDuplicate) {
    const others = await scope.query((db, owns) =>
      db
        .select({ id: question.id, number: question.number, text: question.stemText })
        .from(question)
        .where(owns(question, and(eq(question.subjectId, subj.id), ne(question.status, "archived"), args.id ? ne(question.id, args.id) : undefined))),
    );
    const dupes = findDuplicates(v.value.stemText, others).slice(0, 3);
    if (dupes.length) {
      return {
        ok: false,
        duplicates: dupes.map((d) => ({ id: d.id, code: questionCode(subj.name, subj.code, d.number), text: d.text })),
      };
    }
  }

  const reviewer = await canReview(scope, actor, subj.id);
  let status: Status = existing?.status ?? "draft";
  if (args.submit) status = reviewer ? "approved" : "pending";
  else if (!existing) status = "draft";
  // An author changing an approved question sends it back for approval.
  else if (existing.status === "approved" && !reviewer) status = "pending";
  else if (existing.status === "returned") status = "returned";

  const topicId = await resolveTopic(scope, subj.id, input.classLevelId, input.topicName);
  const values = {
    subjectId: subj.id,
    classLevelId: input.classLevelId,
    topicId,
    passageId: input.passageId,
    type: input.type,
    stem: input.stem,
    stemText: v.value.stemText,
    answer: v.value.answer,
    marks: input.marks,
    difficulty: input.difficulty,
    status,
    ...(status === "approved" && reviewer ? { reviewedBy: actor.id, reviewedAt: new Date(), reviewComment: null } : {}),
  };

  const saved = await scope.transaction(async (tx) => {
    let row: typeof question.$inferSelect;
    if (existing) {
      // Moving subject gives the question a new number in its new subject.
      const number = existing.subjectId === subj.id ? existing.number : await nextNumber(tx, subj.id);
      [row] = await tx.update(question, { ...values, number }, eq(question.id, existing.id));
      await tx.delete(questionOption, eq(questionOption.questionId, existing.id));
    } else {
      [row] = await tx.insert(question, {
        ...values,
        number: await nextNumber(tx, subj.id),
        authorId: actor.id,
        source: args.source ?? "manual",
        explanation: args.explanation?.trim() || null,
      });
    }
    if (v.value.options.length) {
      await tx.insert(questionOption, v.value.options.map((o) => ({ ...o, questionId: row.id })));
    }
    return row;
  });

  await scope.query((db) =>
    audit(db, {
      schoolId: scope.schoolId,
      actorUserId: actor.id,
      action: existing ? "question.update" : "question.create",
      entityType: "question",
      entityId: saved.id,
      meta: { status },
    }),
  );
  return { ok: true, id: saved.id, code: questionCode(subj.name, subj.code, saved.number), status };
}

async function nextNumber(scope: TenantScope, subjectId: string): Promise<number> {
  const [row] = await scope.query((db, owns) =>
    db
      .select({ n: sql<number>`coalesce(max(${question.number}), 0) + 1` })
      .from(question)
      .where(owns(question, eq(question.subjectId, subjectId))),
  );
  return Number(row.n);
}

/**
 * Adds many new questions to one subject in one go (imports). Same checks and
 * statuses as `saveQuestion`, but a fixed handful of queries however long the
 * paper is. Results line up with `items`; ones that fail their checks are
 * reported and the rest are added. Run it inside a transaction for all-or-nothing.
 */
export async function addQuestions(
  scope: TenantScope,
  actor: Actor,
  args: {
    subjectId: string;
    submit: boolean;
    source: (typeof question.$inferSelect)["source"];
    items: { input: QuestionInput; explanation?: string | null }[];
  },
): Promise<SaveResult[]> {
  if (!can(actor, "question.create", { schoolId: scope.schoolId })) throw new QuestionError("You can't add questions.");
  const subj = await scope.findFirst(subject, eq(subject.id, args.subjectId));
  if (!subj) throw new QuestionError("Choose a subject.");

  const classIds = [...new Set(args.items.map((i) => i.input.classLevelId).filter((x): x is string => !!x))];
  const passageIds = [...new Set(args.items.map((i) => i.input.passageId).filter((x): x is string => !!x))];
  const [levels, passages] = await Promise.all([
    classIds.length ? scope.findMany(classLevel, inArray(classLevel.id, classIds)) : [],
    passageIds.length ? scope.findMany(passage, and(inArray(passage.id, passageIds), eq(passage.subjectId, subj.id))) : [],
  ]);
  const okLevels = new Set(levels.map((l) => l.id));
  const okPassages = new Set(passages.map((p) => p.id));

  const reviewer = can(actor, "question.approve", { schoolId: scope.schoolId, departmentId: subj.departmentId });
  const status: Status = args.submit ? (reviewer ? "approved" : "pending") : "draft";

  const results: SaveResult[] = [];
  const valid: { index: number; input: QuestionInput; value: Extract<ReturnType<typeof validateQuestion>, { ok: true }>["value"]; explanation?: string | null }[] = [];
  args.items.forEach(({ input, explanation }, index) => {
    const v = validateQuestion(input);
    if (!v.ok) results[index] = v;
    else if (input.subjectId !== subj.id) results[index] = { ok: false, errors: ["Choose a subject."] };
    else if (input.classLevelId && !okLevels.has(input.classLevelId)) results[index] = { ok: false, errors: ["Choose a class."] };
    else if (input.passageId && !okPassages.has(input.passageId)) results[index] = { ok: false, errors: ["That passage belongs to another subject."] };
    else valid.push({ index, input, value: v.value, explanation });
  });
  if (!valid.length) return results;

  // Topics: one lookup for every name used, one insert for the new ones.
  const clean = (name: string) => name.trim().replace(/\s+/g, " ");
  const topicKey = (classLevelId: string | null, name: string) => `${classLevelId ?? ""}|${clean(name).toLowerCase()}`;
  const wanted = new Map<string, { classLevelId: string | null; name: string }>();
  for (const { input } of valid) {
    if (clean(input.topicName)) wanted.set(topicKey(input.classLevelId, input.topicName), { classLevelId: input.classLevelId, name: clean(input.topicName) });
  }
  const topicIds = new Map<string, string>();
  if (wanted.size) {
    const names = [...new Set([...wanted.values()].map((w) => w.name.toLowerCase()))];
    const found = await scope.findMany(topic, and(eq(topic.subjectId, subj.id), inArray(sql`lower(${topic.name})`, names)));
    for (const t of found) topicIds.set(topicKey(t.classLevelId, t.name), t.id);
    const missing = [...wanted.entries()].filter(([k]) => !topicIds.has(k)).map(([, w]) => ({ subjectId: subj.id, classLevelId: w.classLevelId, name: w.name }));
    for (const t of await scope.insert(topic, missing)) topicIds.set(topicKey(t.classLevelId, t.name), t.id);
  }

  const first = await nextNumber(scope, subj.id);
  const reviewed = status === "approved" ? { reviewedBy: actor.id, reviewedAt: new Date(), reviewComment: null } : {};
  const rows = await scope.insert(
    question,
    valid.map(({ input, value, explanation }, i) => ({
      subjectId: subj.id,
      classLevelId: input.classLevelId,
      topicId: clean(input.topicName) ? (topicIds.get(topicKey(input.classLevelId, input.topicName)) ?? null) : null,
      passageId: input.passageId,
      type: input.type,
      stem: input.stem,
      stemText: value.stemText,
      answer: value.answer,
      marks: input.marks,
      difficulty: input.difficulty,
      status,
      ...reviewed,
      number: first + i,
      authorId: actor.id,
      source: args.source,
      explanation: explanation?.trim() || null,
    })),
  );
  const byNumber = new Map(rows.map((r) => [r.number, r]));
  const options = valid.flatMap(({ value }, i) => value.options.map((o) => ({ ...o, questionId: byNumber.get(first + i)!.id })));
  await scope.insert(questionOption, options);
  await scope.query((db) =>
    audit(db, { schoolId: scope.schoolId, actorUserId: actor.id, action: "question.create", entityType: "question", meta: { status, count: rows.length, source: args.source } }),
  );

  valid.forEach(({ index }, i) => {
    const row = byNumber.get(first + i)!;
    results[index] = { ok: true, id: row.id, code: questionCode(subj.name, subj.code, row.number), status };
  });
  return results;
}

// ─── Workflow ────────────────────────────────────────────────────────────────

export type WorkflowAction = "submit" | "approve" | "return" | "archive" | "restore";

const TRANSITIONS: Record<WorkflowAction, { from: Status[]; to: Status; reviewerOnly: boolean }> = {
  submit: { from: ["draft", "returned"], to: "pending", reviewerOnly: false },
  approve: { from: ["pending", "draft", "returned"], to: "approved", reviewerOnly: true },
  return: { from: ["pending", "approved"], to: "returned", reviewerOnly: true },
  archive: { from: ["draft", "pending", "returned", "approved"], to: "archived", reviewerOnly: false },
  restore: { from: ["archived"], to: "draft", reviewerOnly: true },
};

/**
 * Moves questions through draft → pending → approved (or returned with a comment).
 * Returns how many changed; questions the actor may not act on are skipped.
 */
export async function applyWorkflow(
  scope: TenantScope,
  actor: Actor,
  ids: string[],
  action: WorkflowAction,
  comment?: string,
): Promise<{ changed: number; skipped: number }> {
  const t = TRANSITIONS[action];
  if (action === "return" && !comment?.trim()) throw new QuestionError("Say what needs changing, so the author can fix it.");
  const rows = ids.length ? await scope.findMany(question, inArray(question.id, ids)) : [];
  let changed = 0;
  for (const q of rows) {
    if (!t.from.includes(q.status)) continue;
    const reviewer = await canReview(scope, actor, q.subjectId);
    const allowed = t.reviewerOnly ? reviewer : reviewer || q.authorId === actor.id;
    if (!allowed) continue;
    // A reviewer submitting approves directly.
    const to = action === "submit" && reviewer ? "approved" : t.to;
    await scope.update(
      question,
      {
        status: to,
        ...(action === "approve" || action === "return" || to === "approved"
          ? { reviewedBy: actor.id, reviewedAt: new Date(), reviewComment: action === "return" ? comment!.trim() : null }
          : {}),
      },
      eq(question.id, q.id),
    );
    changed++;
  }
  if (changed) {
    await scope.query((db) =>
      audit(db, { schoolId: scope.schoolId, actorUserId: actor.id, action: `question.${action}`, entityType: "question", meta: { ids, changed, comment } }),
    );
  }
  return { changed, skipped: ids.length - changed };
}

/** Bulk tag a topic or move to another class level. Only questions the actor can edit change. */
export async function bulkUpdate(
  scope: TenantScope,
  actor: Actor,
  ids: string[],
  patch: { topicName?: string; classLevelId?: string | null },
): Promise<{ changed: number }> {
  const rows = ids.length ? await scope.findMany(question, inArray(question.id, ids)) : [];
  let changed = 0;
  for (const q of rows) {
    if (!(await canEdit(scope, actor, q))) continue;
    const classLevelId = patch.classLevelId !== undefined ? patch.classLevelId : q.classLevelId;
    const topicId = patch.topicName !== undefined ? await resolveTopic(scope, q.subjectId, classLevelId, patch.topicName) : q.topicId;
    await scope.update(question, { classLevelId, topicId }, eq(question.id, q.id));
    changed++;
  }
  return { changed };
}

/** Authors can delete their own drafts; everything else is archived instead. */
export async function deleteDraft(scope: TenantScope, actor: Actor, id: string) {
  const q = await scope.findFirst(question, eq(question.id, id));
  if (!q || q.status !== "draft" || q.authorId !== actor.id) throw new QuestionError("Only your own drafts can be deleted. Archive it instead.");
  await scope.delete(question, eq(question.id, id));
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export type BankFilters = {
  subjectId?: string;
  classLevelId?: string;
  topicId?: string;
  type?: QuestionType;
  difficulty?: "easy" | "medium" | "hard";
  status?: Status | "mine";
  source?: (typeof question.$inferSelect)["source"];
  q?: string;
};

export type BankRow = {
  id: string;
  code: string;
  text: string;
  topic: string | null;
  type: QuestionType;
  difficulty: "easy" | "medium" | "hard";
  status: Status;
  marks: number;
  timesUsed: number;
  author: string | null;
  mine: boolean;
};

export const PAGE_SIZE = 50;

/**
 * The bank. Everyone sees approved, pending and returned questions; drafts are
 * visible only to their author. Archived questions show only when asked for.
 */
export async function listQuestions(
  scope: TenantScope,
  actor: Actor,
  f: BankFilters,
  page = 0,
): Promise<{ rows: BankRow[]; total: number }> {
  return scope.query(async (db, owns) => {
    const conds: SQL[] = [];
    if (f.subjectId) conds.push(eq(question.subjectId, f.subjectId));
    if (f.classLevelId) conds.push(eq(question.classLevelId, f.classLevelId));
    if (f.topicId) conds.push(eq(question.topicId, f.topicId));
    if (f.type) conds.push(eq(question.type, f.type));
    if (f.difficulty) conds.push(eq(question.difficulty, f.difficulty));
    if (f.source) conds.push(eq(question.source, f.source));
    if (f.status === "mine") conds.push(eq(question.authorId, actor.id), ne(question.status, "archived"));
    else if (f.status) conds.push(eq(question.status, f.status));
    else conds.push(ne(question.status, "archived"));
    conds.push(or(ne(question.status, "draft"), eq(question.authorId, actor.id))!);
    const q = f.q?.trim();
    if (q) {
      conds.push(
        or(
          sql`to_tsvector('english', ${question.stemText}) @@ plainto_tsquery('english', ${q})`,
          ilike(question.stemText, `%${q.replace(/[%_]/g, "")}%`),
        )!,
      );
    }
    const where = owns(question, and(...conds));
    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id: question.id,
          number: question.number,
          text: question.stemText,
          topic: topic.name,
          type: question.type,
          difficulty: question.difficulty,
          status: question.status,
          marks: question.marks,
          timesUsed: questionStats.timesUsed,
          author: user.name,
          authorId: question.authorId,
          subjectName: subject.name,
          subjectCode: subject.code,
        })
        .from(question)
        .innerJoin(subject, owns(subject, eq(subject.id, question.subjectId)))
        .leftJoin(topic, owns(topic, eq(topic.id, question.topicId)))
        .leftJoin(questionStats, owns(questionStats, eq(questionStats.questionId, question.id)))
        .leftJoin(user, eq(user.id, question.authorId))
        .where(where)
        .orderBy(desc(question.updatedAt), asc(question.number))
        .limit(PAGE_SIZE)
        .offset(page * PAGE_SIZE),
      db.select({ total: sql<number>`count(*)::int` }).from(question).where(where),
    ]);
    return {
      total: Number(total),
      rows: rows.map((r) => ({
        id: r.id,
        code: questionCode(r.subjectName, r.subjectCode, r.number),
        text: r.text,
        topic: r.topic,
        type: r.type,
        difficulty: r.difficulty,
        status: r.status,
        marks: r.marks,
        timesUsed: r.timesUsed ?? 0,
        author: r.author,
        mine: r.authorId === actor.id,
      })),
    };
  });
}

export type QuestionDetail = typeof question.$inferSelect & {
  code: string;
  subjectName: string;
  classLevelCode: string | null;
  topicName: string | null;
  passage: { id: string; title: string; content: RichDoc } | null;
  options: (typeof questionOption.$inferSelect)[];
  stats: typeof questionStats.$inferSelect | null;
  authorName: string | null;
};

export async function getQuestion(scope: TenantScope, actor: Actor, id: string): Promise<QuestionDetail | null> {
  const q = await scope.findFirst(question, eq(question.id, id));
  if (!q || (q.status === "draft" && q.authorId !== actor.id)) return null;
  const [subj, level, tpc, psg, options, stats, author] = await Promise.all([
    scope.findFirst(subject, eq(subject.id, q.subjectId)),
    q.classLevelId ? scope.findFirst(classLevel, eq(classLevel.id, q.classLevelId)) : undefined,
    q.topicId ? scope.findFirst(topic, eq(topic.id, q.topicId)) : undefined,
    q.passageId ? scope.findFirst(passage, eq(passage.id, q.passageId)) : undefined,
    scope.findMany(questionOption, eq(questionOption.questionId, q.id)),
    scope.findFirst(questionStats, eq(questionStats.questionId, q.id)),
    q.authorId ? scope.query((db) => db.select({ name: user.name }).from(user).where(eq(user.id, q.authorId!))) : [],
  ]);
  return {
    ...q,
    code: questionCode(subj?.name ?? "", subj?.code, q.number),
    subjectName: subj?.name ?? "",
    classLevelCode: level?.code ?? null,
    topicName: tpc?.name ?? null,
    passage: psg ? { id: psg.id, title: psg.title, content: psg.content } : null,
    options: options.sort((a, b) => a.sortOrder - b.sortOrder),
    stats: stats ?? null,
    authorName: author[0]?.name ?? null,
  };
}

/** Editor form values for an existing question. */
export function toInput(q: QuestionDetail): QuestionInput {
  const a = q.answer as QuestionAnswer;
  return {
    type: q.type,
    subjectId: q.subjectId,
    classLevelId: q.classLevelId,
    topicName: q.topicName ?? "",
    passageId: q.passageId,
    stem: q.stem,
    marks: q.marks,
    difficulty: q.difficulty,
    options: q.options.map((o) => ({ content: o.content, isCorrect: o.isCorrect })),
    scoring: a.kind === "mcq_multi" ? a.scoring : "all_or_nothing",
    trueFalse: a.kind === "true_false" ? a.correct : null,
    accepted: a.kind === "fill_blank" ? a.accepted : [],
    caseSensitive: a.kind === "fill_blank" ? a.caseSensitive : false,
    numericValue: a.kind === "numeric" ? String(a.value) : "",
    tolerance: a.kind === "numeric" ? String(a.tolerance) : "",
    markingGuide: a.kind === "theory" ? a.markingGuide : null,
  };
}

// ─── Topics & passages ───────────────────────────────────────────────────────

export function listTopics(scope: TenantScope, subjectId?: string) {
  return scope.query((db, owns) =>
    db
      .select({ id: topic.id, name: topic.name, subjectId: topic.subjectId, classLevelId: topic.classLevelId })
      .from(topic)
      .where(owns(topic, subjectId ? eq(topic.subjectId, subjectId) : undefined))
      .orderBy(asc(topic.name)),
  );
}

export function listPassages(scope: TenantScope, subjectId?: string) {
  return scope.query((db, owns) =>
    db
      .select({ id: passage.id, title: passage.title, subjectId: passage.subjectId, classLevelId: passage.classLevelId })
      .from(passage)
      .where(owns(passage, subjectId ? eq(passage.subjectId, subjectId) : undefined))
      .orderBy(desc(passage.updatedAt)),
  );
}

export async function savePassage(
  scope: TenantScope,
  actor: Actor,
  args: { id?: string; subjectId: string; classLevelId: string | null; title: string; content: RichDoc },
) {
  if (!can(actor, "question.create", { schoolId: scope.schoolId })) throw new QuestionError("You can't add passages.");
  const err = validateDoc(args.content, 40_000);
  if (err) throw new QuestionError(`Passage: ${err}`);
  const title = args.title.trim();
  if (!title) throw new QuestionError("Give the passage a short title.");
  if (!(await scope.findFirst(subject, eq(subject.id, args.subjectId)))) throw new QuestionError("Choose a subject.");
  const values = { subjectId: args.subjectId, classLevelId: args.classLevelId, title, content: args.content, contentText: docToText(args.content) };
  if (args.id) {
    const [row] = await scope.update(passage, values, eq(passage.id, args.id));
    if (!row) throw new QuestionError("Passage not found.");
    return row;
  }
  const [row] = await scope.insert(passage, { ...values, authorId: actor.id });
  return row;
}

export async function getPassage(scope: TenantScope, id: string) {
  return scope.findFirst(passage, eq(passage.id, id));
}

/** Questions waiting for this person's approval (HODs: their department only). */
export async function countAwaitingReview(scope: TenantScope, actor: Actor): Promise<number> {
  const reviewerRoles = ["school_admin", "exam_officer", "hod"];
  if (!actor.roles.some((r) => r.schoolId === scope.schoolId && reviewerRoles.includes(r.role))) return 0;
  const rows = await scope.query((db, owns) =>
    db
      .select({ departmentId: subject.departmentId, n: sql<number>`count(*)::int` })
      .from(question)
      .innerJoin(subject, owns(subject, eq(subject.id, question.subjectId)))
      .where(owns(question, eq(question.status, "pending")))
      .groupBy(subject.departmentId),
  );
  return rows
    .filter((r) => can(actor, "question.approve", { schoolId: scope.schoolId, departmentId: r.departmentId }))
    .reduce((a, r) => a + Number(r.n), 0);
}
