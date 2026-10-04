/**
 * "Simple" questions: plain text with $…$ maths, as written in a spreadsheet or
 * returned by the AI (photo reading and question writing). Converted to
 * ParsedItems for the review screen. Pure.
 */
import { blankItem, textToDoc, type Flag, type ParsedItem } from "./items";

export type SimpleQuestion = {
  number?: number | null;
  type?: string | null;
  stem: string;
  options?: string[];
  /** Letter(s) "B" / "A,C", "True"/"False", text, or a number. */
  answer?: string | null;
  marks?: number | null;
  topic?: string | null;
  difficulty?: string | null;
  explanation?: string | null;
};

const TYPES: Record<string, ParsedItem["type"]> = {
  objective: "mcq_single",
  mcq: "mcq_single",
  "multiple choice": "mcq_single",
  single: "mcq_single",
  mcq_single: "mcq_single",
  "multiple answer": "mcq_multi",
  multi: "mcq_multi",
  mcq_multi: "mcq_multi",
  "true/false": "true_false",
  "true or false": "true_false",
  truefalse: "true_false",
  true_false: "true_false",
  "fill in the gap": "fill_blank",
  "fill in the blank": "fill_blank",
  gap: "fill_blank",
  fill_blank: "fill_blank",
  numeric: "numeric",
  number: "numeric",
  theory: "theory",
  essay: "theory",
};

function difficulty(v: string | null | undefined): ParsedItem["difficulty"] {
  const d = (v ?? "").trim().toLowerCase();
  if (d.startsWith("e") || d === "1") return "easy";
  if (d.startsWith("h") || d === "3") return "hard";
  return "medium";
}

export function simpleToItem(q: SimpleQuestion, flags: Flag[] = []): ParsedItem {
  const options = (q.options ?? []).map((o) => o.trim()).filter(Boolean);
  const answer = (q.answer ?? "").trim();
  const declared = q.type ? TYPES[q.type.trim().toLowerCase()] : undefined;
  const letters = /^[A-Fa-f](\s*[,&/ ]\s*(and\s+)?[A-Fa-f])*$/.test(answer) ? [...answer.matchAll(/[A-Fa-f]/g)].map((m) => m[0].toUpperCase()) : [];
  const tf = /^(true|false|t|f)$/i.test(answer) ? /^t/i.test(answer) : null;
  const numeric = /^[-+]?\d[\d,]*(\.\d+)?$|^[-+]?\d+\s*\/\s*\d+$/.test(answer);

  let type: ParsedItem["type"] =
    declared ??
    (options.length >= 2
      ? letters.length > 1
        ? "mcq_multi"
        : "mcq_single"
      : tf !== null
        ? "true_false"
        : answer && numeric && !/_{3,}|\.{4,}/.test(q.stem)
          ? "numeric"
          : answer && (/_{3,}|\.{4,}/.test(q.stem) || answer.split(/\s+/).length <= 3)
            ? "fill_blank"
            : "theory");
  // True/false written as two options.
  if ((type === "mcq_single" || type === "true_false") && options.length === 2 && options.every((o) => /^(true|false)$/i.test(o))) {
    type = "true_false";
  }

  const item = blankItem({
    number: q.number ?? null,
    type,
    stem: textToDoc(q.stem.trim()),
    marks: q.marks && q.marks > 0 ? q.marks : type === "theory" ? 5 : 1,
    topicName: (q.topic ?? "").trim(),
    difficulty: difficulty(q.difficulty),
    explanation: q.explanation?.trim() || null,
    flags,
  });

  if (type === "mcq_single" || type === "mcq_multi") {
    item.options = options.slice(0, 6).map((o, i) => ({ content: textToDoc(o), isCorrect: letters.includes(String.fromCharCode(65 + i)) }));
    if (options.length > 6) item.flags.push({ level: "amber", message: "More than 6 options; only A–F were kept." });
  } else if (type === "true_false") {
    const idx = letters[0] ? letters[0].charCodeAt(0) - 65 : -1;
    item.trueFalse = tf ?? (idx >= 0 && options[idx] ? /^t/i.test(options[idx]) : null);
  } else if (type === "fill_blank") {
    item.accepted = answer ? answer.split(/\s*[|/;]\s*/).filter(Boolean) : [];
  } else if (type === "numeric") {
    item.numericValue = answer.replace(/,/g, "");
  } else if (type === "theory" && answer) {
    item.markingGuide = textToDoc(answer);
  }
  return item;
}
