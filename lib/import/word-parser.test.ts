import { describe, expect, it } from "vitest";
import { docToText } from "@/lib/questions/rich";
import type { Block } from "./docx";
import { assess } from "./items";
import { parseQuestionPaper } from "./word-parser";

const para = (text: string, fmt: { bold?: boolean } = {}): Block => ({ kind: "para", runs: [{ text, ...fmt }] });
const parse = (...lines: (string | Block)[]) => parseQuestionPaper(lines.map((l) => (typeof l === "string" ? para(l) : l)));

describe("word parser edge cases", () => {
  it("splits a question whose start ran into the previous option (design: Q39/Q40)", () => {
    const { items } = parse(
      "39. Which gas turns lime water milky?",
      "A. Oxygen",
      "B. Carbon(IV) oxide",
      "C. Nitrogen",
      "D. Hydrogen 40. The process of converting a liquid to vapour is called",
      "A. melting B. evaporation C. freezing D. condensation",
      "Ans: B",
    );
    expect(items.map((i) => i.number)).toEqual([39, 40]);
    expect(docToText(items[0].options[3].content)).toBe("Hydrogen");
    expect(docToText(items[1].stem)).toMatch(/The process of converting/);
    expect(items[1].options).toHaveLength(4);
    expect(assess(items[0]).confidence).toBe("amber");
  });

  it("flags two answers marked on a one-answer question", () => {
    const { items } = parse("1. Which of the following is an element?", "A. Brass", "B. Copper*", "C. Sulphur*", "D. Steel");
    const a = assess(items[0]);
    expect(a.confidence).toBe("amber");
    expect(a.reasons[0]).toMatch(/2 answers marked \(B and C\)/);
  });

  it("flags a missing diagram and numbering jumps", () => {
    const { items } = parse("1. The apparatus shown in the diagram is used for", "A. x B. y C. z D. w", "Ans: A", "3. Next?", "A. 1 B. 2 C. 3 D. 4", "Ans: B");
    expect(assess(items[0]).reasons.join()).toMatch(/diagram/);
    expect(assess(items[1]).reasons.join()).toMatch(/jumps from 1 to 3/);
  });

  it("doesn't mistake decimals for question numbers", () => {
    const { items } = parse("1. A stone weighs", "3.5 kg on earth. What is its mass?", "A. 3.5 kg B. 35 kg C. 0.35 kg D. 350 kg", "Ans: A");
    expect(items).toHaveLength(1);
    expect(docToText(items[0].stem)).toMatch(/3\.5 kg on earth/);
  });

  it("ignores the header and instructions before the first question", () => {
    const { items, notes } = parse("GREENFIELD ACADEMY", "Time: 1 hour", "Answer all questions", "1. 2 + 2 =", "A. 3 B. 4 C. 5 D. 6", "Ans: B");
    expect(items).toHaveLength(1);
    expect(notes).toContain("Time: 1 hour");
  });

  it("does not treat bold on every option as an answer", () => {
    const { items } = parse("1. Pick one", para("A. one", { bold: true }), para("B. two", { bold: true }), para("C. three", { bold: true }), para("D. four", { bold: true }));
    expect(items[0].options.some((o) => o.isCorrect)).toBe(false);
  });

  it("reads keyed text answers for gap-fill questions", () => {
    const { items } = parse("1. The capital of Nigeria is ______.", "2. Water freezes at ______ °C.", "ANSWERS", "1. Abuja", "2. 0");
    expect(items[0]).toMatchObject({ type: "fill_blank", accepted: ["Abuja"] });
    expect(items[1]).toMatchObject({ type: "fill_blank", accepted: ["0"] });
  });

  it("keeps theory sub-parts in the stem, not as options", () => {
    const { items } = parse("SECTION B: THEORY", "1. (a) Define osmosis.", "(b) Give two examples. (4 marks)");
    expect(items[0].type).toBe("theory");
    expect(items[0].options).toHaveLength(0);
    expect(docToText(items[0].stem)).toMatch(/Give two examples/);
    expect(items[0].marks).toBe(4);
  });
});
