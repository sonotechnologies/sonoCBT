/**
 * Imported questions awaiting review. Every import route (Word, photo, sheet,
 * AI) produces ParsedItems; the review screen edits them; accepted ones become
 * bank questions. Pure and isomorphic.
 */
import type { RichDoc } from "@/lib/db/schema";
import { validateQuestion, type QuestionInput, type QuestionType } from "@/lib/questions/model";
import { docToText, EMPTY_DOC, isEmptyDoc } from "@/lib/questions/rich";

export type Confidence = "green" | "amber" | "red";

/** Something the importer noticed. Parse-time flags clear once a teacher has edited the question. */
export type Flag = { level: "amber" | "red"; message: string };

export type ParsedItem = {
  id: string;
  /** Number in the source, if any. */
  number: number | null;
  type: QuestionType;
  stem: RichDoc;
  options: { content: RichDoc; isCorrect: boolean }[];
  accepted: string[];
  trueFalse: boolean | null;
  numericValue: string;
  markingGuide: RichDoc | null;
  explanation: string | null;
  marks: number;
  topicName: string;
  difficulty: "easy" | "medium" | "hard";
  passageKey: string | null;
  flags: Flag[];
  /** Index of the source block, to highlight the original. */
  source: number | null;
  status: "review" | "accepted" | "skipped" | "saved";
  questionId?: string;
};

export type ParsedPassage = { key: string; title: string; content: RichDoc; questionId?: string };

// ─── Building rich content ───────────────────────────────────────────────────

/** A run of source text with the formatting that matters for questions. */
export type Run = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  highlight?: boolean;
  sup?: boolean;
  sub?: boolean;
  /** Maths converted from Word (or typed as $…$). */
  math?: { latex: string; ok: boolean };
  image?: { src: string; alt: string };
};

type PMNode = Record<string, unknown>;

/** Runs → paragraph content (images become their own blocks after the paragraph). */
function runsToBlocks(runs: Run[]): PMNode[] {
  const inline: PMNode[] = [];
  const after: PMNode[] = [];
  for (const r of runs) {
    if (r.image) after.push({ type: "image", attrs: { src: r.image.src, alt: r.image.alt } });
    else if (r.math) inline.push({ type: "inlineMath", attrs: { latex: r.math.latex } });
    else if (r.text) {
      const marks = [...(r.sup ? [{ type: "superscript" }] : []), ...(r.sub ? [{ type: "subscript" }] : [])];
      const last = inline.at(-1);
      // Merge adjacent text with identical marks.
      if (last?.type === "text" && JSON.stringify(last.marks ?? []) === JSON.stringify(marks)) last.text = String(last.text) + r.text;
      else inline.push({ type: "text", text: r.text, ...(marks.length ? { marks } : {}) });
    }
  }
  // Trim the paragraph's outer whitespace.
  const first = inline[0];
  if (first?.type === "text") first.text = String(first.text).replace(/^\s+/, "");
  const lastT = inline.at(-1);
  if (lastT?.type === "text") lastT.text = String(lastT.text).replace(/\s+$/, "");
  const content = inline.filter((n) => n.type !== "text" || String(n.text) !== "");
  return [{ type: "paragraph", ...(content.length ? { content } : {}) }, ...after];
}

export function runsToDoc(paragraphs: Run[][]): RichDoc {
  const content = paragraphs.flatMap(runsToBlocks).filter((b) => b.type !== "paragraph" || (b.content as unknown[] | undefined)?.length);
  return content.length ? { type: "doc", content } : EMPTY_DOC;
}

/** "Evaluate $\frac{1}{2}$ now" → runs with inline maths. Used for AI, photo and sheet text. */
export function textToRuns(text: string): Run[] {
  const out: Run[] = [];
  const re = /\$\$?([^$]+)\$\$?/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: "", math: { latex: m[1].trim(), ok: true } });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function textToDoc(text: string): RichDoc {
  return runsToDoc(text.split(/\n+/).map(textToRuns));
}

// ─── Assessment ──────────────────────────────────────────────────────────────

export function toInput(item: ParsedItem, subjectId: string, classLevelId: string | null, passageId: string | null): QuestionInput {
  return {
    type: item.type,
    subjectId,
    classLevelId,
    topicName: item.topicName,
    passageId,
    stem: item.stem,
    marks: item.marks,
    difficulty: item.difficulty,
    options: item.options,
    scoring: "all_or_nothing",
    trueFalse: item.trueFalse,
    accepted: item.accepted,
    caseSensitive: false,
    numericValue: item.numericValue,
    tolerance: "",
    markingGuide: item.markingGuide,
  };
}

const PLAIN_PROBLEMS: [RegExp, string][] = [
  [/one correct option/, "No answer found. Tap the right option."],
  [/at least one correct option/, "No answer found. Tap the right options."],
  [/Add at least 2 options/, "Options not found."],
  [/Write the question/, "The question text is missing."],
  [/accepted answer/, "No accepted answer found."],
  [/true or false/, "Say whether it's true or false."],
  [/Enter the answer as a number/, "No numeric answer found."],
];

/** Problems that stop the question being saved, in teacher language. */
export function blockingProblems(item: ParsedItem): string[] {
  const v = validateQuestion(toInput(item, "subject", null, null));
  if (v.ok) return [];
  return v.errors.map((e) => PLAIN_PROBLEMS.find(([re]) => re.test(e))?.[1] ?? e);
}

/** Current state: red if it can't be saved, amber if a flag still stands, green otherwise. */
export function assess(item: ParsedItem): { confidence: Confidence; reasons: string[] } {
  const blocking = blockingProblems(item);
  const correct = item.options.filter((o) => o.isCorrect).length;
  const reasons = [...item.flags.map((f) => f.message)];
  // Two answers marked on a one-answer question is a "check", not a "fix".
  const multiMarked = item.type === "mcq_single" && correct > 1;
  if (multiMarked) {
    const letters = item.options.map((o, i) => (o.isCorrect ? "ABCDEF"[i] : null)).filter(Boolean);
    reasons.unshift(`${letters.length} answers marked (${letters.join(" and ")}). Pick one.`);
  }
  const hardBlocking = blocking.filter((b) => !(multiMarked && /No answer found/.test(b)));
  const noAnswer = hardBlocking.some((b) => /No answer found|No accepted answer|No numeric answer|true or false/.test(b));
  const otherBlocking = hardBlocking.filter((b) => !/No answer found|No accepted answer|No numeric answer|true or false/.test(b));
  reasons.unshift(...hardBlocking);

  let confidence: Confidence = "green";
  if (item.flags.some((f) => f.level === "amber") || multiMarked || noAnswer) confidence = "amber";
  if (item.flags.some((f) => f.level === "red") || otherBlocking.length) confidence = "red";
  return { confidence, reasons: [...new Set(reasons)] };
}

export function progress(items: ParsedItem[]) {
  const live = items.filter((i) => i.status !== "skipped");
  const ready = live.filter((i) => i.status === "accepted" || i.status === "saved").length;
  const counts = { green: 0, amber: 0, red: 0 };
  for (const i of live) if (i.status === "review") counts[assess(i).confidence]++;
  return { total: live.length, ready, ...counts };
}

// ─── Editing helpers ─────────────────────────────────────────────────────────

let seq = 0;
export const newItemId = () => `i${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function blankItem(over: Partial<ParsedItem> = {}): ParsedItem {
  return {
    id: newItemId(),
    number: null,
    type: "mcq_single",
    stem: EMPTY_DOC,
    options: [],
    accepted: [],
    trueFalse: null,
    numericValue: "",
    markingGuide: null,
    explanation: null,
    marks: 1,
    topicName: "",
    difficulty: "medium",
    passageKey: null,
    flags: [],
    source: null,
    status: "review",
    ...over,
  };
}

/** Joins `b` onto `a` (stems, then options). Used when a question was split across a page. */
export function mergeItems(a: ParsedItem, b: ParsedItem): ParsedItem {
  const stem: RichDoc = { type: "doc", content: [...((isEmptyDoc(a.stem) ? [] : a.stem.content) ?? []), ...((isEmptyDoc(b.stem) ? [] : b.stem.content) ?? [])] };
  return {
    ...a,
    stem,
    options: [...a.options, ...b.options].slice(0, 6),
    accepted: [...a.accepted, ...b.accepted],
    trueFalse: a.trueFalse ?? b.trueFalse,
    numericValue: a.numericValue || b.numericValue,
    markingGuide: a.markingGuide ?? b.markingGuide,
    flags: [],
    type: a.options.length || b.options.length ? a.type === "theory" ? "mcq_single" : a.type : a.type,
  };
}

/** Splits a question's stem before paragraph `at`: the tail becomes a new question. */
export function splitItem(item: ParsedItem, at: number): [ParsedItem, ParsedItem] {
  const blocks = item.stem.content ?? [];
  const head: RichDoc = { type: "doc", content: blocks.slice(0, at) };
  const tail: RichDoc = { type: "doc", content: blocks.slice(at) };
  return [
    { ...item, stem: head, options: [], flags: [] },
    { ...item, id: newItemId(), number: item.number ? item.number + 1 : null, stem: tail, flags: [] },
  ];
}

export function itemTitle(item: ParsedItem): string {
  return docToText(item.stem).slice(0, 80);
}
