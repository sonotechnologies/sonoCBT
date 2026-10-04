/**
 * Phase 3 acceptance: the fixture .docx files parse with ≥90% of questions
 * correct without edits. "Correct" = right type, stem, options and answer, and
 * the confidence the fixture expects (green unless it says otherwise).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { docToText } from "@/lib/questions/rich";
import { readDocx } from "./docx";
import { assess, type ParsedItem } from "./items";
import { parseQuestionPaper } from "./word-parser";
import type { Expected } from "../../scripts/make-import-fixtures";

const DIR = path.join(__dirname, "fixtures");
const fixtures = readdirSync(DIR)
  .filter((f) => f.endsWith(".docx"))
  .sort();

let uploads = 0;
const fakeUpload = async () => `/files/test/img-${++uploads}.png`;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function check(item: ParsedItem | undefined, e: Expected): string[] {
  if (!item) return [`Q${e.n}: not found`];
  const errs: string[] = [];
  const stem = norm(docToText(item.stem)).replace(/\s/g, "");
  if (item.type !== e.type) errs.push(`type ${item.type} ≠ ${e.type}`);
  if (!stem.includes(norm(e.stem).replace(/\s/g, ""))) errs.push(`stem "${docToText(item.stem)}" lacks "${e.stem}"`);
  if (e.options !== undefined && item.options.length !== e.options) errs.push(`${item.options.length} options ≠ ${e.options}`);
  if (e.correct !== undefined) {
    const got = item.options.map((o, i) => (o.isCorrect ? "ABCDEF"[i] : "")).join("");
    if (got !== e.correct) errs.push(`answer "${got}" ≠ "${e.correct}"`);
  }
  if (e.tf !== undefined && item.trueFalse !== e.tf) errs.push(`true/false ${item.trueFalse} ≠ ${e.tf}`);
  if (e.accepted !== undefined && !item.accepted.map(norm).includes(norm(e.accepted))) errs.push(`accepted ${JSON.stringify(item.accepted)} lacks ${e.accepted}`);
  if (e.numeric !== undefined && item.numericValue !== e.numeric) errs.push(`numeric ${item.numericValue} ≠ ${e.numeric}`);
  if (e.marks !== undefined && item.marks !== e.marks) errs.push(`marks ${item.marks} ≠ ${e.marks}`);
  if (e.passage && !item.passageKey) errs.push("not linked to the passage");
  const { confidence, reasons } = assess(item);
  if (confidence !== (e.confidence ?? "green")) errs.push(`confidence ${confidence} ≠ ${e.confidence ?? "green"} (${reasons.join("; ")})`);
  return errs.map((x) => `Q${e.n}: ${x}`);
}

describe("Word import fixtures", () => {
  let total = 0;
  let correct = 0;
  const failures: string[] = [];

  it.each(fixtures)("%s", async (file) => {
    const expected: Expected[] = JSON.parse(readFileSync(path.join(DIR, file.replace(/\.docx$/, ".expected.json")), "utf8"));
    const { blocks } = await readDocx(readFileSync(path.join(DIR, file)), fakeUpload);
    const { items } = parseQuestionPaper(blocks);
    // No invented questions.
    expect(items.map((i) => i.number)).toEqual(expected.map((e) => e.n));
    for (const e of expected) {
      const errs = check(items.find((i) => i.number === e.n), e);
      total++;
      if (errs.length) failures.push(`${file} ${errs.join(" | ")}`);
      else correct++;
    }
  });

  it("gets at least 90% of questions right without edits", () => {
    if (failures.length) console.info(failures.join("\n"));
    console.info(`Word import accuracy: ${correct}/${total} (${Math.round((correct / total) * 100)}%)`);
    expect(total).toBeGreaterThanOrEqual(80);
    expect(correct / total).toBeGreaterThanOrEqual(0.9);
  });
});

describe("original view mapping", () => {
  it.each(fixtures)("%s: HTML top-level elements line up with block origins", async (file) => {
    const { blocks, html } = await readDocx(readFileSync(path.join(DIR, file)), fakeUpload);
    const flat = html.replace(/<table[\s\S]*?<\/table>/g, "<table></table>");
    const topLevel = flat.match(/<(p|h[1-6]|table)\b/g) ?? [];
    const maxOrigin = Math.max(...blocks.map((b) => b.origin ?? -1));
    expect(topLevel.length).toBe(maxOrigin + 1);
  });
});
