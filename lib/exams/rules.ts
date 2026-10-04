/**
 * Pure exam rules: per-student order, deadlines, entry, and marking.
 * No I/O, so they are unit-tested directly and shared by server code.
 */
import type { AttemptResponse, ExamQuestionSnapshot } from "@/lib/db/schema";
import { checkFillBlank, checkNumeric, scoreMultiAnswer } from "@/lib/questions/model";
import { isAnswered } from "./local";

export { isAnswered };

// ─── Seeded order ────────────────────────────────────────────────────────────

/** Small, fast PRNG (mulberry32) seeded from a string: same seed → same order, on any machine. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(list: readonly T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type OrderInput = {
  id: string;
  sectionOrder: number;
  sortOrder: number;
  passageId: string | null;
  type: ExamQuestionSnapshot["type"];
  optionIds: string[];
};

/**
 * A student's question and option order. Sections stay in order; within a
 * section, questions sharing a passage stay together (in their set order) and
 * move as one block. True/false keeps True before False.
 */
export function buildOrder(
  questions: OrderInput[],
  opts: { shuffleQuestions: boolean; shuffleOptions: boolean },
  seed: string,
): { questionOrder: string[]; optionOrder: Record<string, string[]> } {
  const rand = seededRandom(seed);
  const sections = [...new Set(questions.map((q) => q.sectionOrder))].sort((a, b) => a - b);
  const questionOrder: string[] = [];
  for (const s of sections) {
    const inSection = questions.filter((q) => q.sectionOrder === s).sort((a, b) => a.sortOrder - b.sortOrder);
    const blocks: OrderInput[][] = [];
    const byPassage = new Map<string, OrderInput[]>();
    for (const q of inSection) {
      if (!q.passageId) blocks.push([q]);
      else if (byPassage.has(q.passageId)) byPassage.get(q.passageId)!.push(q);
      else {
        const block = [q];
        byPassage.set(q.passageId, block);
        blocks.push(block);
      }
    }
    for (const b of opts.shuffleQuestions ? shuffle(blocks, rand) : blocks) questionOrder.push(...b.map((q) => q.id));
  }
  const optionOrder: Record<string, string[]> = {};
  for (const q of questions) {
    if (!q.optionIds.length) continue;
    optionOrder[q.id] = opts.shuffleOptions && q.type !== "true_false" ? shuffle(q.optionIds, rand) : [...q.optionIds];
  }
  return { questionOrder, optionOrder };
}

// ─── Time ────────────────────────────────────────────────────────────────────

/** How long after the deadline an answer that was already in flight is still accepted. */
export const SYNC_GRACE_MS = 90_000;

type Window = { windowStart: Date; windowEnd: Date; lateEntryUntil: Date | null; durationMinutes: number };

/** Late start rule: deadline = min(start + duration, window end), plus any extra time granted. */
export function attemptDeadline(exam: Window, startedAt: Date, extraSeconds = 0): Date {
  const natural = Math.min(startedAt.getTime() + exam.durationMinutes * 60_000, exam.windowEnd.getTime());
  return new Date(natural + extraSeconds * 1000);
}

export type EntryCheck = { ok: true } | { ok: false; reason: "not_open" | "late" | "closed"; message: string };

export function canStart(exam: Window, now: Date): EntryCheck {
  if (now < exam.windowStart) return { ok: false, reason: "not_open", message: "This exam hasn't opened yet." };
  if (now >= exam.windowEnd) return { ok: false, reason: "closed", message: "This exam has closed." };
  if (exam.lateEntryUntil && now > exam.lateEntryUntil) {
    return { ok: false, reason: "late", message: "Late entry for this exam has closed. Speak to your invigilator." };
  }
  return { ok: true };
}

/** Past the deadline and past the grace for in-flight answers: the server finishes the attempt. */
export function isOverdue(deadlineAt: Date, now: Date): boolean {
  return now.getTime() > deadlineAt.getTime() + SYNC_GRACE_MS;
}

// ─── Responses & marking ─────────────────────────────────────────────────────

/** A response is only kept if it fits the question it's for. */
export function validResponse(q: Pick<ExamQuestionSnapshot, "type" | "options">, r: AttemptResponse | null): boolean {
  if (r === null) return true;
  switch (q.type) {
    case "mcq_single":
      return r.kind === "choice" && r.optionIds.length <= 1 && r.optionIds.every((id) => q.options.some((o) => o.id === id));
    case "mcq_multi":
      return r.kind === "choice" && new Set(r.optionIds).size === r.optionIds.length && r.optionIds.every((id) => q.options.some((o) => o.id === id));
    case "true_false":
      return r.kind === "bool";
    case "fill_blank":
    case "numeric":
      return r.kind === "text" && r.text.length <= 200;
    case "theory":
      return r.kind === "text" && r.text.length <= 20_000;
  }
}

export type Marked = { isCorrect: boolean | null; marksAwarded: number | null };

/**
 * Server-side marking. Objective types are marked here; theory waits for a
 * teacher (null marks). An empty answer scores 0.
 */
export function markResponse(q: ExamQuestionSnapshot, marks: number, r: AttemptResponse | null): Marked {
  if (q.type === "theory") return { isCorrect: null, marksAwarded: isAnswered(r) ? null : 0 };
  if (!isAnswered(r) || !r) return { isCorrect: false, marksAwarded: 0 };
  const correctIds = q.options.filter((o) => o.isCorrect).map((o) => o.id);
  let got = 0;
  switch (q.type) {
    case "mcq_single":
      got = r.kind === "choice" && r.optionIds.length === 1 && correctIds.includes(r.optionIds[0]) ? marks : 0;
      break;
    case "mcq_multi":
      got = r.kind === "choice" && q.answer.kind === "mcq_multi" ? scoreMultiAnswer(r.optionIds, correctIds, q.answer.scoring, marks) : 0;
      break;
    case "true_false":
      got = r.kind === "bool" && q.answer.kind === "true_false" && r.value === q.answer.correct ? marks : 0;
      break;
    case "fill_blank":
      got = r.kind === "text" && q.answer.kind === "fill_blank" && checkFillBlank(r.text, q.answer) ? marks : 0;
      break;
    case "numeric":
      got = r.kind === "text" && q.answer.kind === "numeric" && checkNumeric(r.text, q.answer) ? marks : 0;
      break;
  }
  return { isCorrect: got >= marks, marksAwarded: got };
}
