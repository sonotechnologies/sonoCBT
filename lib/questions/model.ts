/** Question types, validation, answer checking and duplicate detection. Pure and isomorphic. */
import type { QuestionAnswer, RichDoc } from "@/lib/db/schema";
import { docToText, isEmptyDoc, validateDoc } from "./rich";

export type QuestionType = QuestionAnswer["kind"];

export const TYPE_LABEL: Record<QuestionType, string> = {
  mcq_single: "Objective",
  mcq_multi: "Multiple answer",
  true_false: "True / false",
  fill_blank: "Fill in the gap",
  numeric: "Numeric",
  theory: "Theory",
};

export const OPTION_LABELS = ["A", "B", "C", "D", "E", "F"] as const;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

export type QuestionInput = {
  type: QuestionType;
  subjectId: string;
  classLevelId: string | null;
  topicName: string;
  passageId: string | null;
  stem: RichDoc;
  marks: number;
  difficulty: "easy" | "medium" | "hard";
  options: { content: RichDoc; isCorrect: boolean }[];
  scoring: "all_or_nothing" | "partial";
  trueFalse: boolean | null;
  accepted: string[];
  caseSensitive: boolean;
  numericValue: string;
  tolerance: string;
  markingGuide: RichDoc | null;
};

export type NormalisedQuestion = {
  stemText: string;
  answer: QuestionAnswer;
  options: { label: string; content: RichDoc; contentText: string; isCorrect: boolean; sortOrder: number }[];
};

export type Validation = { ok: true; value: NormalisedQuestion } | { ok: false; errors: string[] };

export function validateQuestion(q: QuestionInput): Validation {
  const errors: string[] = [];
  const docErr = validateDoc(q.stem);
  if (docErr) errors.push(`Question: ${docErr}`);
  else if (isEmptyDoc(q.stem)) errors.push("Write the question.");
  if (!q.subjectId) errors.push("Choose a subject.");
  if (!(q.marks > 0) || q.marks > 100) errors.push("Marks must be between 0 and 100.");

  let answer: QuestionAnswer = { kind: "mcq_single" };
  let options: NormalisedQuestion["options"] = [];

  switch (q.type) {
    case "mcq_single":
    case "mcq_multi": {
      const filled = q.options.filter((o) => !isEmptyDoc(o.content));
      if (filled.length !== q.options.length) errors.push("Fill in every option, or remove the empty ones.");
      if (q.options.length < MIN_OPTIONS) errors.push(`Add at least ${MIN_OPTIONS} options.`);
      if (q.options.length > MAX_OPTIONS) errors.push(`Use at most ${MAX_OPTIONS} options (A–F).`);
      for (const [i, o] of q.options.entries()) {
        const e = validateDoc(o.content, 4000);
        if (e) errors.push(`Option ${OPTION_LABELS[i] ?? i + 1}: ${e}`);
      }
      const correct = q.options.filter((o) => o.isCorrect).length;
      if (q.type === "mcq_single" && correct !== 1) errors.push("Tap the bubble of the one correct option.");
      if (q.type === "mcq_multi" && correct < 1) errors.push("Mark at least one correct option.");
      const texts = q.options.map((o) => optionKey(docToText(o.content)));
      if (new Set(texts).size !== texts.length && filled.length === q.options.length) errors.push("Two options are the same.");
      options = q.options.map((o, i) => ({
        label: OPTION_LABELS[i],
        content: o.content,
        contentText: docToText(o.content),
        isCorrect: o.isCorrect,
        sortOrder: i + 1,
      }));
      answer = q.type === "mcq_single" ? { kind: "mcq_single" } : { kind: "mcq_multi", scoring: q.scoring };
      break;
    }
    case "true_false":
      if (q.trueFalse === null) errors.push("Choose whether the statement is true or false.");
      answer = { kind: "true_false", correct: !!q.trueFalse };
      break;
    case "fill_blank": {
      const accepted = [...new Set(q.accepted.map((a) => a.trim().replace(/\s+/g, " ")).filter(Boolean))];
      if (!accepted.length) errors.push("Add at least one accepted answer.");
      answer = { kind: "fill_blank", accepted, caseSensitive: q.caseSensitive };
      break;
    }
    case "numeric": {
      const value = parseNumber(q.numericValue);
      const tolerance = q.tolerance.trim() ? parseNumber(q.tolerance) : 0;
      if (value === null) errors.push("Enter the answer as a number, e.g. 0.5 or 1/2.");
      if (tolerance === null || tolerance < 0) errors.push("Tolerance must be 0 or a positive number.");
      answer = { kind: "numeric", value: value ?? 0, tolerance: tolerance ?? 0 };
      break;
    }
    case "theory": {
      if (q.markingGuide) {
        const e = validateDoc(q.markingGuide);
        if (e) errors.push(`Marking guide: ${e}`);
      }
      answer = { kind: "theory", markingGuide: q.markingGuide && !isEmptyDoc(q.markingGuide) ? q.markingGuide : null };
      break;
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { stemText: docToText(q.stem), answer, options } };
}

// ─── Answer checking (used by marking in later phases) ─────────────────────

/** "0.5", "1/2", "1 1/2", "-3", "1,000", "½" → number; null if not a number. */
export function parseNumber(input: string): number | null {
  const s = input.trim().replace(/,/g, "").replace(/\s+/g, " ");
  if (!s) return null;
  const unicode: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };
  if (s in unicode) return unicode[s];
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return Number(s);
  const frac = /^([-+]?)(?:(\d+) )?(\d+)\/(\d+)$/.exec(s);
  if (frac) {
    const [, sign, whole, num, den] = frac;
    if (Number(den) === 0) return null;
    const v = Number(whole ?? 0) + Number(num) / Number(den);
    return sign === "-" ? -v : v;
  }
  return null;
}

export function checkNumeric(response: string, answer: { value: number; tolerance: number }): boolean {
  const v = parseNumber(response);
  return v !== null && Math.abs(v - answer.value) <= answer.tolerance + 1e-9;
}

export function checkFillBlank(response: string, answer: { accepted: string[]; caseSensitive: boolean }): boolean {
  const norm = (s: string) => {
    const t = s.trim().replace(/\s+/g, " ").replace(/[.!]$/, "");
    return answer.caseSensitive ? t : t.toLowerCase();
  };
  const r = norm(response);
  return !!r && answer.accepted.some((a) => norm(a) === r);
}

/** Marks for a multiple-answer question. Partial: +1 per right choice, −1 per wrong, never below 0. */
export function scoreMultiAnswer(
  selected: string[],
  correct: string[],
  scoring: "all_or_nothing" | "partial",
  marks: number,
): number {
  const sel = new Set(selected);
  const right = correct.filter((c) => sel.has(c)).length;
  const wrong = [...sel].filter((s) => !correct.includes(s)).length;
  if (scoring === "all_or_nothing") return right === correct.length && wrong === 0 ? marks : 0;
  return Math.max(0, Math.round(((right - wrong) / correct.length) * marks * 100) / 100);
}

// ─── Duplicates ──────────────────────────────────────────────────────────────

/** Case, spacing and punctuation don't make a question different. */
/**
 * For spotting repeated options: ignores case, spacing and a trailing full stop,
 * but keeps symbols, so (x−2)(x−3) and (x+2)(x+3) stay different.
 */
export function optionKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").replace(/[.!,;:]+$/, "");
}

export function normaliseForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/\$+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const t = s.replace(/ /g, "");
  const m = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice similarity of character bigrams, 0–1. */
export function similarity(a: string, b: string): number {
  const x = normaliseForCompare(a);
  const y = normaliseForCompare(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = bigrams(x);
  const B = bigrams(y);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of A) {
    overlap += Math.min(n, B.get(g) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return total ? (2 * overlap) / total : 0;
}

export const DUPLICATE_THRESHOLD = 0.9;

export function findDuplicates<T extends { id: string; text: string }>(
  text: string,
  candidates: T[],
  threshold = DUPLICATE_THRESHOLD,
): (T & { score: number })[] {
  return candidates
    .map((c) => ({ ...c, score: similarity(text, c.text) }))
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

// ─── Codes ───────────────────────────────────────────────────────────────────

const KNOWN_CODES: Record<string, string> = {
  "english language": "ENG",
  mathematics: "MTH",
  "further mathematics": "FMT",
  chemistry: "CHM",
  physics: "PHY",
  biology: "BIO",
  "basic science": "BSC",
  "basic technology": "BTC",
  "social studies": "SST",
  "civic education": "CVE",
  "business studies": "BUS",
  "agricultural science": "AGR",
  "computer studies": "CMP",
  "literature in english": "LIT",
  economics: "ECO",
  government: "GOV",
  geography: "GEO",
  "financial accounting": "ACC",
  commerce: "COM",
  "crs / irs": "REL",
};

export function subjectCode(name: string, code?: string | null): string {
  if (code?.trim()) return code.trim().toUpperCase();
  const known = KNOWN_CODES[name.trim().toLowerCase()];
  if (known) return known;
  return (
    name
      .replace(/[^A-Za-z ]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .padEnd(3, name.replace(/[^A-Za-z]/g, "").toUpperCase().slice(1, 3))
      .slice(0, 3) || "QST"
  );
}

export function questionCode(subjectName: string, subjectCodeOverride: string | null | undefined, n: number): string {
  return `${subjectCode(subjectName, subjectCodeOverride)}-${String(n).padStart(4, "0")}`;
}
