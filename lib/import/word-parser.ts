/**
 * Turns a question paper (as blocks of formatted runs) into reviewable
 * questions. Recognises the ways Nigerian teachers usually type papers.
 * Pure: no I/O, fully unit-tested (see word-parser.test.ts and fixtures/).
 */
import type { Block } from "./docx";
import { blankItem, runsToDoc, type Flag, type ParsedItem, type ParsedPassage, type Run } from "./items";

const OBJ = "￼"; // stands in for maths and images when matching text

type Line = { runs: Run[]; text: string; block: number };

export type ParseResult = { items: ParsedItem[]; passages: ParsedPassage[]; notes: string[] };

// ─── Line helpers ────────────────────────────────────────────────────────────

const runLen = (r: Run) => (r.math || r.image ? 1 : r.text.length);
const runText = (r: Run) => (r.math || r.image ? OBJ : r.text);

function makeLine(runs: Run[], block: number): Line {
  const clean = runs.map((r) => (r.math || r.image ? r : { ...r, text: r.text.replace(/[  -​]/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'") }));
  return { runs: clean, text: clean.map(runText).join(""), block };
}

/** Runs covering text offsets [start, end). */
function slice(line: Line, start: number, end = line.text.length): Run[] {
  const out: Run[] = [];
  let pos = 0;
  for (const r of line.runs) {
    const len = runLen(r);
    const a = Math.max(start, pos);
    const b = Math.min(end, pos + len);
    if (a < b) out.push(r.math || r.image ? r : { ...r, text: r.text.slice(a - pos, b - pos) });
    pos += len;
  }
  return out;
}

function sub(line: Line, start: number, end = line.text.length): Line {
  return makeLine(slice(line, start, end), line.block);
}

function trim(line: Line): Line {
  const s = line.text.length - line.text.trimStart().length;
  const e = line.text.trimEnd().length;
  return sub(line, s, Math.max(s, e));
}

/** Drops matching text from the end of a line (e.g. "(2 marks)" or "*"). */
function cut(line: Line, re: RegExp): Line {
  const m = re.exec(line.text);
  if (!m) return line;
  return trim(makeLine([...slice(line, 0, m.index), ...slice(line, m.index + m[0].length)], line.block));
}

/** Is (almost) all visible text in this line bold / underlined / highlighted? */
function emphasised(line: Line): boolean {
  const visible = line.runs.filter((r) => (r.math || r.image ? false : r.text.trim().length > 0));
  if (!visible.length) return false;
  const chars = (pred: (r: Run) => boolean) => visible.filter(pred).reduce((n, r) => n + r.text.trim().length, 0);
  const total = chars(() => true);
  const marked = chars((r) => !!(r.bold || r.underline || r.highlight));
  return marked / total >= 0.8;
}

// ─── Patterns ────────────────────────────────────────────────────────────────

const Q_START = [
  /^\s*(?:q(?:uestion|n)?\.?\s*|no\.?\s*)?\((\d{1,3})\)\s*/i,
  /^\s*(?:q(?:uestion|n)?\.?\s*|no\.?\s*)?(\d{1,3})\s*(?:[.)]|:)(?=\s|$)\s*/i,
  /^\s*question\s+(\d{1,3})\b\s*[:.\-–]?\s*/i,
  /^\s*q(\d{1,3})\b\s*[:.\-–]?\s*/i,
];
const OPT_START = /^\s*(?:\(([a-fA-F])\)|([a-fA-F])\s*[.)])(?=\s|$)\s*/;
const OPT_ANY = /(^|\s)(?:\(([a-fA-F])\)|([a-fA-F])[.)])(?=\s)/g;
const SUBPART = /^\s*\(?(?:i{1,3}|iv|v|vi{0,3}|ix|x)\)\s+|^\s*\(?[a-h]\)\s+/i;
const ANSWER = /^\s*(?:ans(?:wer)?s?|correct\s+(?:answer|option)|key|solution)\s*[:.\-=–]\s*/i;
const KEY_HEADER = /^\s*(?:(?:objective\s+)?answers?\s*(?:key|sheet)?|answer\s*key|marking\s+(?:scheme|guide)|key|solutions?)\s*[:.]?\s*$/i;
const KEY_PAIR = /(\d{1,3})\s*[.):\-–]?\s*\(?([a-fA-F])\)?(?![a-zA-Z])/g;
const SECTION = /^\s*(?:(section|part)\s+([a-z0-9]{1,3})\b|(objectives?|objective\s+questions|multiple[\s-]choice(?:\s+questions)?|theory|essay(?:\s+questions)?|subjective|short\s+answers?(?:\s+questions)?|fill\s+in\s+the\s+(?:gaps?|blanks?)|true\s+or\s+false|comprehension)\b)(.*)$/i;
const PASSAGE = /\b(?:read|study)\s+the\s+(?:following\s+)?(?:passage|extract|text|story|poem)|^\s*comprehension\b/i;
const RANGE = /questions?\s+(\d{1,3})\s*(?:-|–|—|to|and)\s*(\d{1,3})/i;
const MARKS = /[([]\s*(\d+(?:\.\d+)?)\s*(?:marks?|mks?|pts?|points?)\s*[)\]]\s*$/i;
const BLANK = /_{3,}|\.{4,}|…{2,}/;
const DIAGRAM = /\b(?:diagram|figure|fig\.|graph|picture|image|sketch)\s+(?:above|below|shown)|shown\s+(?:in|on)\s+the\s+(?:diagram|figure|graph)|\bthe\s+(?:diagram|figure)\b/i;
const STAR = /\s*(?:\*+|✓|✔|\(correct\))\s*$|^\s*(?:\*+|✓|✔)\s*/;
const TRAILING_LETTER = /\s*\(\s*([A-F])\s*\)\s*$/;
const TRUE_FALSE_STEM = /^\s*(?:true\s+or\s+false|state\s+(?:whether|if)\b.*\btrue\b|t\s*\/\s*f)\b[:.\-]?\s*/i;

function questionStart(text: string): { n: number; rest: number } | null {
  for (const re of Q_START) {
    const m = re.exec(text);
    if (m) return { n: Number(m[1]), rest: m[0].length };
  }
  return null;
}

/** Option markers in the line that run on in order from `from` (0 = A, 1 = B…). */
function optionMarkers(text: string, from = 0): { letter: string; at: number; end: number }[] {
  const found: { letter: string; at: number; end: number }[] = [];
  for (const m of text.matchAll(OPT_ANY)) {
    const letter = (m[2] ?? m[3]).toUpperCase();
    const at = m.index! + m[1].length;
    const expect = String.fromCharCode(65 + from + found.length);
    if (letter === expect) {
      const endMatch = /\s*/.exec(text.slice(m.index! + m[0].length));
      found.push({ letter, at, end: m.index! + m[0].length + (endMatch?.[0].length ?? 0) });
    }
  }
  return found;
}

function keyPairs(text: string): [number, string][] {
  return [...text.matchAll(KEY_PAIR)].map((m) => [Number(m[1]), m[2].toUpperCase()]);
}

/** A line made only of "1. B 2. D 3-A"-style pairs. */
function isKeyLine(text: string, minPairs: number): boolean {
  const pairs = keyPairs(text);
  if (pairs.length < minPairs) return false;
  return text.replace(KEY_PAIR, "").replace(/[\s,;|/]+/g, "") === "";
}

// ─── Parser ──────────────────────────────────────────────────────────────────

type Mode = "auto" | "objective" | "theory" | "fill" | "truefalse";

type Draft = {
  number: number | null;
  block: number;
  stem: Line[];
  options: Line[];
  answerLetters: string[];
  answerText: string | null;
  answerRuns: Line[];
  extra: string[];
  mode: Mode;
  passageKey: string | null;
  flags: Flag[];
};

export function parseQuestionPaper(blocks: Block[]): ParseResult {
  const lines: Line[] = [];
  const keyFromTables = new Map<number, string>();

  blocks.forEach((b, index) => {
    const i = b.origin ?? index;
    if (b.kind === "para") {
      lines.push(makeLine(b.runs, i));
      return;
    }
    // An answer-key table: rows of [number, letter] (possibly several pairs per row).
    const cellTexts = b.rows.map((row) => row.map((c) => c.map(runText).join("").trim()));
    const flat = cellTexts.flat().join(" ");
    if (keyPairs(flat).length >= 2 && cellTexts.every((row) => row.every((c) => /^\s*(\d{1,3}[.)]?|\(?[a-fA-F]\)?|\d{1,3}\s*[.):\-]?\s*[a-fA-F])?\s*$/.test(c)))) {
      for (const row of cellTexts) for (const [n, l] of keyPairs(row.join(" "))) keyFromTables.set(n, l);
      return;
    }
    for (const row of b.rows) {
      const cells = row.map((c) => makeLine(c, i));
      // [ "1." | "What is…" ] → one line.
      if (cells.length > 1 && /^\s*\(?\d{1,3}[.)]?\)?\s*$/.test(cells[0].text)) {
        const num = cells[0].text.trim().replace(/[().]/g, "");
        lines.push(makeLine([{ text: `${num}. ` }, ...cells.slice(1).flatMap((c) => [...c.runs, { text: " " }])], i));
        continue;
      }
      for (const c of cells) for (const part of c.text.split("\n")) if (part.trim()) lines.push(sub(c, c.text.indexOf(part), c.text.indexOf(part) + part.length));
    }
  });

  const items: ParsedItem[] = [];
  const passages: ParsedPassage[] = [];
  const notes: string[] = [];
  const key = new Map<number, string>();
  const textAnswers = new Map<number, string>();

  let mode: Mode = "auto";
  let q: Draft | null = null;
  let keyMode = false;
  let passage: { key: string; title: string; paras: Line[]; range: [number, number] | null; open: boolean } | null = null;
  let lastNumber = 0;
  let passageSeq = 0;

  const finish = () => {
    if (q) items.push(finalise(q));
    q = null;
  };

  const closePassage = () => {
    if (!passage?.open) return;
    passage.open = false;
    const paras = passage.paras.filter((l) => l.text.trim() || l.runs.some((r) => r.image || r.math));
    if (paras.length) {
      passages.push({ key: passage.key, title: passage.title || `Passage ${passageSeq}`, content: runsToDoc(paras.map((l) => l.runs)) });
    }
  };

  const startQuestion = (n: number | null, block: number) => {
    finish();
    const flags: Flag[] = [];
    if (n !== null && lastNumber && n !== lastNumber + 1) {
      flags.push({ level: "amber", message: n <= lastNumber ? `Question ${n} appears twice.` : `Numbering jumps from ${lastNumber} to ${n}.` });
    }
    if (n !== null) lastNumber = n;
    let passageKey: string | null = null;
    if (passage) {
      if (passage.range ? n !== null && n >= passage.range[0] && n <= passage.range[1] : true) passageKey = passage.key;
      if (passage.range && n !== null && n > passage.range[1]) passage = null;
    }
    q = { number: n, block, stem: [], options: [], answerLetters: [], answerText: null, answerRuns: [], extra: [], mode, passageKey, flags };
  };

  const addOption = (line: Line) => {
    if (!q) return;
    const nextNum = lastNumber + 1;
    // Next question's start swallowed into this option ("Hydrogen 40. The process of…").
    const joined = new RegExp(`\\s(${nextNum})\\s*[.)]\\s+(?=\\S)`).exec(line.text);
    if (joined && joined.index > 0) {
      const optionPart = trim(sub(line, 0, joined.index));
      q.options.push(optionPart);
      q.flags.push({ level: "amber", message: `Option ${String.fromCharCode(64 + q.options.length)} ran into question ${nextNum}. We split them; check both.` });
      const block = line.block;
      startQuestion(nextNum, block);
      q.flags.push({ level: "amber", message: `Found inside the previous question's option. Check it's complete.` });
      q.stem.push(trim(sub(line, joined.index + joined[0].length)));
      return;
    }
    q.options.push(trim(line));
  };

  /** A line that may hold several options ("A. 2  B. 4  C. 6  D. 8"). */
  const addOptionsFrom = (line: Line, markers: { at: number; end: number }[]) => {
    markers.forEach((m, i) => addOption(sub(line, m.end, i + 1 < markers.length ? markers[i + 1].at : line.text.length)));
  };

  for (const raw of lines) {
    const line = trim(raw);
    const t = line.text;
    if (!t) {
      if (passage?.open && passage.paras.length) passage.paras.push(line);
      continue;
    }

    // Answer keys at the end of the paper.
    if (KEY_HEADER.test(t)) {
      finish();
      keyMode = true;
      continue;
    }
    if (isKeyLine(t, keyMode ? 1 : 3)) {
      finish();
      keyMode = true;
      for (const [n, l] of keyPairs(t)) key.set(n, l);
      continue;
    }
    if (keyMode) {
      // "12. evaporation" in a key: text answers for gap-fill questions.
      const m = /^\s*(\d{1,3})\s*[.):\-–]\s*(.+)$/.exec(t);
      if (m) {
        textAnswers.set(Number(m[1]), m[2].trim());
        continue;
      }
      keyMode = false;
    }

    // Section headers.
    const sec = SECTION.exec(t);
    if (sec && t.length < 120 && !questionStart(t)) {
      finish();
      closePassage();
      passage = null;
      const words = t.toLowerCase();
      if (/theory|essay|subjective|short\s+answer/.test(words)) mode = "theory";
      else if (/objective|multiple[\s-]choice/.test(words)) mode = "objective";
      else if (/fill\s+in/.test(words)) mode = "fill";
      else if (/true\s+or\s+false/.test(words)) mode = "truefalse";
      else if (/comprehension/.test(words)) mode = "auto";
      else mode = "auto";
      if (PASSAGE.test(t)) {
        passage = { key: `p${++passageSeq}`, title: "", paras: [], range: rangeOf(t), open: true };
      }
      notes.push(`Section: ${t}`);
      continue;
    }

    // Comprehension passages.
    if (PASSAGE.test(t) && !questionStart(t)) {
      finish();
      closePassage();
      passage = { key: `p${++passageSeq}`, title: "", paras: [], range: rangeOf(t), open: true };
      notes.push(`Passage instructions: ${t}`);
      continue;
    }

    const qs = questionStart(t);
    const isOption = OPT_START.test(t);

    // Answer lines.
    if (q && ANSWER.test(t)) {
      const value = trim(sub(line, ANSWER.exec(t)![0].length));
      const letters = /^\(?([A-Fa-f])\)?(?:\s*(?:,|and|&)\s*\(?([A-Fa-f])\)?)*\s*[.]?$/.test(value.text)
        ? [...value.text.matchAll(/[A-Fa-f]/g)].map((m) => m[0].toUpperCase())
        : [];
      const d = q as Draft;
      if (letters.length && (d.options.length || d.mode !== "theory")) d.answerLetters = letters;
      else {
        d.answerText = value.text;
        d.answerRuns.push(value);
      }
      continue;
    }

    if (qs && !(q && isOption && !qs)) {
      closePassage();
      startQuestion(qs.n, line.block);
      const rest = sub(line, qs.rest);
      const inline = optionMarkers(rest.text);
      const d = q as unknown as Draft;
      if (d.mode !== "theory" && inline.length >= 2 && inline[0].at > 0) {
        d.stem.push(trim(sub(rest, 0, inline[0].at)));
        addOptionsFrom(rest, inline);
      } else d.stem.push(trim(rest));
      continue;
    }

    if (passage?.open) {
      if (!passage.title && t.length < 70 && !/[.?!]$/.test(t)) passage.title = t;
      else passage.paras.push(line);
      continue;
    }

    if (!q) {
      notes.push(t);
      continue;
    }
    const d = q as Draft;

    if (d.mode === "theory" || (d.mode === "auto" && !d.options.length && SUBPART.test(t) && !/^\s*\(?[a-f][.)]/i.test(t))) {
      d.stem.push(line);
      continue;
    }
    if (isOption) {
      const markers = optionMarkers(t, d.options.length);
      if (markers.length && markers[0].at === 0) {
        addOptionsFrom(line, markers);
        continue;
      }
    }
    if (!d.options.length) d.stem.push(line);
    else {
      // Text after the options that isn't an answer or a new question.
      d.extra.push(t);
    }
  }
  finish();

  // Apply answer keys and keyed text answers.
  for (const it of items) {
    if (it.number === null) continue;
    const letter = keyFromTables.get(it.number) ?? key.get(it.number);
    if (letter && (it.type === "mcq_single" || it.type === "mcq_multi" || it.type === "true_false") && !it.options.some((o) => o.isCorrect) && it.trueFalse === null) {
      applyLetter(it, [letter]);
    }
    const text = textAnswers.get(it.number);
    if (text && it.type === "fill_blank" && !it.accepted.length) it.accepted = splitAccepted(text);
  }

  closePassage();
  // Passages no question ended up linked to are dropped.
  const used = new Set(items.map((i) => i.passageKey).filter(Boolean));
  return { items, passages: passages.filter((p) => used.has(p.key)), notes };

  function rangeOf(text: string): [number, number] | null {
    const m = RANGE.exec(text);
    return m ? [Number(m[1]), Number(m[2])] : null;
  }
}

// ─── Finalising a question ───────────────────────────────────────────────────

function splitAccepted(text: string): string[] {
  return text
    .split(/\s*(?:\/|;|\bor\b|,)\s*/i)
    .map((s) => s.trim().replace(/[.]$/, ""))
    .filter(Boolean);
}

function applyLetter(it: ParsedItem, letters: string[]) {
  if (it.type === "true_false" || (it.options.length === 2 && isTrueFalse(it))) {
    const idx = letters.map((l) => l.charCodeAt(0) - 65)[0];
    const text = it.options[idx] ? optionPlain(it.options[idx].content) : "";
    it.trueFalse = /^t/i.test(text);
    return;
  }
  const idx = new Set(letters.map((l) => l.charCodeAt(0) - 65));
  it.options = it.options.map((o, i) => ({ ...o, isCorrect: idx.has(i) }));
}

function optionPlain(doc: ParsedItem["stem"]): string {
  const walk = (n: { text?: string; content?: unknown[] }): string => (n.text ?? "") + (n.content ?? []).map((c) => walk(c as never)).join("");
  return walk(doc as never).trim();
}

function isTrueFalse(it: ParsedItem): boolean {
  const texts = it.options.map((o) => optionPlain(o.content).toLowerCase().replace(/[.]/g, ""));
  return texts.length === 2 && texts.includes("true") && texts.includes("false");
}

function finalise(d: Draft): ParsedItem {
  const flags = [...d.flags];
  let marks = 1;
  let stemLines = d.stem.filter((l) => l.text.trim() || l.runs.some((r) => r.image || r.math));

  // Marks stated on the stem or its sub-parts ("(3 marks)" … "(2 marks)") add up.
  let marksFound = 0;
  stemLines = stemLines.map((l) => {
    const m = MARKS.exec(l.text);
    if (!m) return l;
    marksFound += Number(m[1]);
    return cut(l, MARKS);
  });
  const mm = marksFound > 0;
  if (mm) marks = marksFound;

  // "(B)" at the end of the stem as the answer.
  let letters = [...d.answerLetters];
  const tail = stemLines.at(-1);
  if (!letters.length && tail && d.options.length) {
    const m = TRAILING_LETTER.exec(tail.text);
    if (m && m[1].charCodeAt(0) - 65 < d.options.length) {
      letters = [m[1]];
      stemLines = [...stemLines.slice(0, -1), cut(tail, TRAILING_LETTER)];
    }
  }

  // Answers marked in the options themselves: *, ✓, or bold/underline/highlight on just those options.
  let options = d.options.map((o) => ({ line: o, starred: STAR.test(o.text) }));
  const starred = options.filter((o) => o.starred).length;
  options = options.map((o) => ({ ...o, line: o.starred ? cut(o.line, STAR) : o.line }));
  const emph = options.map((o) => emphasised(o.line));
  const emphCount = emph.filter(Boolean).length;
  const stemEmph = stemLines.length > 0 && stemLines.every(emphasised);
  let correct = options.map(() => false);
  if (letters.length) correct = options.map((_, i) => letters.includes(String.fromCharCode(65 + i)));
  else if (starred) correct = options.map((o) => o.starred);
  else if (emphCount > 0 && emphCount < options.length && !stemEmph) correct = emph;

  const hasImage = [...stemLines, ...d.options].some((l) => l.runs.some((r) => r.image));
  const stemText = stemLines.map((l) => l.text).join(" ");
  if (DIAGRAM.test(stemText) && !hasImage) flags.push({ level: "amber", message: "Mentions a diagram, but the file has no picture here." });
  const badMath = [...stemLines, ...d.options].some((l) => l.runs.some((r) => r.math && !r.math.ok));
  if (badMath) flags.push({ level: "red", message: "Equation needs review. Parts of it couldn't be read; retype it with ∑ Maths." });
  if (d.extra.length) flags.push({ level: "amber", message: `Extra text after the options: "${d.extra.join(" ").slice(0, 80)}"` });
  if (d.options.length === 1) flags.push({ level: "red", message: "Only one option found." });
  else if (d.options.length === 3) flags.push({ level: "amber", message: "Only 3 options." });

  const item = blankItem({
    number: d.number,
    stem: runsToDoc(stemLines.map((l) => l.runs)),
    marks,
    passageKey: d.passageKey,
    source: d.block,
  });

  const answerText = d.answerText?.trim() ?? "";
  const tfStem = TRUE_FALSE_STEM.test(stemText);

  if (d.options.length >= 2) {
    item.options = options.map((o, i) => ({ content: runsToDoc([o.line.runs]), isCorrect: correct[i] }));
    item.type = "mcq_single";
    if (isTrueFalse(item)) {
      const idx = correct.indexOf(true);
      item.type = "true_false";
      item.trueFalse = idx >= 0 ? /^t/i.test(optionPlain(item.options[idx].content)) : null;
      item.options = [];
    }
  } else if (d.mode === "theory" || (d.mode === "auto" && !BLANK.test(stemText) && !answerText && !tfStem)) {
    item.type = "theory";
    if (marks === 1 && !mm) flags.push({ level: "amber", message: "No marks stated. Set the marks." });
    if (d.answerRuns.length) item.markingGuide = runsToDoc(d.answerRuns.map((l) => l.runs));
  } else if (tfStem || d.mode === "truefalse" || /^(true|false|t|f)\.?$/i.test(answerText)) {
    item.type = "true_false";
    item.stem = runsToDoc(stemLines.map((l, i) => (i === 0 ? cut(l, TRUE_FALSE_STEM).runs : l.runs)));
    item.trueFalse = answerText ? /^t/i.test(answerText) : null;
  } else if (!BLANK.test(stemText) && answerText && /^[-+]?[\d.,/ ]+$/.test(answerText) && d.mode !== "fill") {
    item.type = "numeric";
    item.numericValue = answerText.replace(/,/g, "");
  } else if (d.mode === "objective" && !answerText) {
    item.type = "mcq_single";
    flags.push({ level: "red", message: "Options not found." });
  } else {
    item.type = "fill_blank";
    item.accepted = answerText ? splitAccepted(answerText) : [];
  }

  item.flags = flags;
  return item;
}
