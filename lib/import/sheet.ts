/** Excel / CSV question lists (template columns: Question, A–F, Answer, Marks, Topic, Difficulty, Type). Pure. */
import type { ParsedItem } from "./items";
import { simpleToItem } from "./simple";

export const SHEET_TEMPLATE_HEADERS = ["Question", "A", "B", "C", "D", "E", "Answer", "Marks", "Topic", "Difficulty", "Type"] as const;

const key = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");
const ALIASES: Record<string, string[]> = {
  question: ["question", "questions", "stem", "questiontext"],
  answer: ["answer", "answers", "correct", "correctanswer", "key", "ans"],
  marks: ["marks", "mark", "score", "points"],
  topic: ["topic", "topics"],
  difficulty: ["difficulty", "level"],
  type: ["type", "questiontype"],
  explanation: ["explanation", "reason"],
};

export type SheetResult = { items: ParsedItem[]; missingColumns: string[] };

export function readQuestionSheet(sheet: unknown[][]): SheetResult {
  const headerRow = sheet.findIndex((r) => r.some((c) => String(c ?? "").trim()));
  if (headerRow === -1) return { items: [], missingColumns: ["Question"] };
  const header = sheet[headerRow].map((c) => key(String(c ?? "")));
  const col = (name: string) => header.findIndex((h) => ALIASES[name].includes(h));
  const optionCols = ["a", "b", "c", "d", "e", "f"].map((l) => header.findIndex((h) => h === l || h === `option${l}`));

  const q = col("question");
  if (q === -1) return { items: [], missingColumns: ["Question"] };
  const cell = (r: unknown[], i: number) => (i >= 0 && r[i] !== null && r[i] !== undefined ? String(r[i]).trim() : "");

  const items: ParsedItem[] = [];
  sheet.slice(headerRow + 1).forEach((r, i) => {
    const stem = cell(r, q);
    if (!stem) return;
    const item = simpleToItem({
      number: items.length + 1,
      stem,
      options: optionCols.map((c) => cell(r, c)).filter(Boolean),
      answer: cell(r, col("answer")),
      marks: Number(cell(r, col("marks"))) || null,
      topic: cell(r, col("topic")),
      difficulty: cell(r, col("difficulty")),
      type: cell(r, col("type")) || null,
      explanation: cell(r, col("explanation")) || null,
    });
    item.source = headerRow + i + 1;
    items.push(item);
  });
  return { items, missingColumns: [] };
}
