import { describe, expect, it } from "vitest";
import {
  checkFillBlank,
  checkNumeric,
  findDuplicates,
  parseNumber,
  questionCode,
  scoreMultiAnswer,
  similarity,
  validateQuestion,
  type QuestionInput,
} from "./model";
import { EMPTY_DOC, textDoc } from "./rich";

const base: QuestionInput = {
  type: "mcq_single",
  subjectId: "sub",
  classLevelId: null,
  topicName: "",
  passageId: null,
  stem: textDoc("Which gas turns lime water milky?"),
  marks: 1,
  difficulty: "medium",
  options: ["Oxygen", "Hydrogen", "Carbon(IV) oxide", "Nitrogen"].map((t, i) => ({ content: textDoc(t), isCorrect: i === 2 })),
  scoring: "all_or_nothing",
  trueFalse: null,
  accepted: [],
  caseSensitive: false,
  numericValue: "",
  tolerance: "",
  markingGuide: null,
};

const errorsOf = (q: Partial<QuestionInput>) => {
  const r = validateQuestion({ ...base, ...q });
  return r.ok ? [] : r.errors;
};

describe("validateQuestion", () => {
  it("accepts a well-formed objective question and labels options A–D", () => {
    const r = validateQuestion(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.options.map((o) => o.label)).toEqual(["A", "B", "C", "D"]);
      expect(r.value.options[2].isCorrect).toBe(true);
      expect(r.value.stemText).toBe("Which gas turns lime water milky?");
    }
  });

  it("needs exactly one correct option for objective questions", () => {
    expect(errorsOf({ options: base.options.map((o) => ({ ...o, isCorrect: false })) })).toContain("Tap the bubble of the one correct option.");
    expect(errorsOf({ options: base.options.map((o) => ({ ...o, isCorrect: true })) })).toContain("Tap the bubble of the one correct option.");
  });

  it("allows several correct options for multiple-answer questions", () => {
    expect(errorsOf({ type: "mcq_multi", options: base.options.map((o, i) => ({ ...o, isCorrect: i < 2 })) })).toEqual([]);
  });

  it("limits options to 2–6 and rejects empty or repeated options", () => {
    expect(errorsOf({ options: [base.options[2]] })).toContain("Add at least 2 options.");
    const seven = Array.from({ length: 7 }, (_, i) => ({ content: textDoc(`o${i}`), isCorrect: i === 0 }));
    expect(errorsOf({ options: seven })).toContain("Use at most 6 options (A–F).");
    expect(errorsOf({ options: [...base.options.slice(0, 3), { content: EMPTY_DOC, isCorrect: false }] })).toContain(
      "Fill in every option, or remove the empty ones.",
    );
    expect(errorsOf({ options: [{ content: textDoc("Yes"), isCorrect: true }, { content: textDoc(" yes. "), isCorrect: false }] })).toContain(
      "Two options are the same.",
    );
  });

  it("keeps options that differ only by maths symbols apart", () => {
    const opts = ["(x-2)(x-3)", "(x+2)(x+3)", "(x-1)(x-6)", "(x+1)(x-6)"].map((x, i) => ({ content: textDoc(`$${x}$`), isCorrect: i === 0 }));
    expect(errorsOf({ options: opts })).not.toContain("Two options are the same.");
  });

  it("requires a stem", () => {
    expect(errorsOf({ stem: EMPTY_DOC })).toContain("Write the question.");
  });

  it("checks each other type's answer", () => {
    expect(errorsOf({ type: "true_false" })).toContain("Choose whether the statement is true or false.");
    expect(errorsOf({ type: "true_false", trueFalse: false })).toEqual([]);
    expect(errorsOf({ type: "fill_blank", accepted: [" ", ""] })).toContain("Add at least one accepted answer.");
    expect(errorsOf({ type: "numeric", numericValue: "abc" })).toContain("Enter the answer as a number, e.g. 0.5 or 1/2.");
    expect(errorsOf({ type: "numeric", numericValue: "1/2", tolerance: "0.01" })).toEqual([]);
    expect(errorsOf({ type: "theory" })).toEqual([]);
  });

  it("stores de-duplicated accepted answers", () => {
    const r = validateQuestion({ ...base, type: "fill_blank", accepted: ["evaporation", " evaporation ", "Evaporation"] });
    expect(r.ok && r.value.answer).toEqual({ kind: "fill_blank", accepted: ["evaporation", "Evaporation"], caseSensitive: false });
  });
});

describe("answer checking", () => {
  it.each([
    ["0.5", 0.5],
    ["1/2", 0.5],
    ["1 1/2", 1.5],
    ["-3/4", -0.75],
    ["1,000", 1000],
    ["½", 0.5],
    [".25", 0.25],
    ["2e3", 2000],
    ["1/0", null],
    ["half", null],
  ])("parseNumber(%s) = %s", (s, v) => expect(parseNumber(s)).toBe(v));

  it("accepts equivalent numeric forms within tolerance", () => {
    expect(checkNumeric("1/2", { value: 0.5, tolerance: 0 })).toBe(true);
    expect(checkNumeric("0.51", { value: 0.5, tolerance: 0.01 })).toBe(true);
    expect(checkNumeric("0.52", { value: 0.5, tolerance: 0.01 })).toBe(false);
  });

  it("matches fill-in answers ignoring case, spacing and a final full stop", () => {
    const a = { accepted: ["evaporation"], caseSensitive: false };
    expect(checkFillBlank("  Evaporation. ", a)).toBe(true);
    expect(checkFillBlank("evaporate", a)).toBe(false);
    expect(checkFillBlank("Evaporation", { ...a, caseSensitive: true })).toBe(false);
    expect(checkFillBlank("", a)).toBe(false);
  });

  it("scores multiple-answer questions", () => {
    expect(scoreMultiAnswer(["A", "B"], ["A", "B"], "all_or_nothing", 2)).toBe(2);
    expect(scoreMultiAnswer(["A"], ["A", "B"], "all_or_nothing", 2)).toBe(0);
    expect(scoreMultiAnswer(["A"], ["A", "B"], "partial", 2)).toBe(1);
    expect(scoreMultiAnswer(["A", "C"], ["A", "B"], "partial", 2)).toBe(0);
    expect(scoreMultiAnswer(["C", "D"], ["A", "B"], "partial", 2)).toBe(0);
  });
});

describe("duplicates", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(similarity("Which gas turns lime water milky?", "which gas turns limewater milky")).toBeGreaterThan(0.9);
  });
  it("tells different questions apart", () => {
    expect(similarity("Which gas turns lime water milky?", "Which metal is an alkaline earth metal?")).toBeLessThan(0.6);
  });
  it("finds near-duplicates above the threshold", () => {
    const found = findDuplicates("What is the pH of a 0.001 M HCl solution?", [
      { id: "1", text: "What is the pH of a 0.001M HCl solution" },
      { id: "2", text: "State two uses of sodium chloride." },
    ]);
    expect(found.map((f) => f.id)).toEqual(["1"]);
  });
});

describe("question codes", () => {
  it("uses known subject codes, else initials", () => {
    expect(questionCode("Chemistry", null, 412)).toBe("CHM-0412");
    expect(questionCode("Mathematics", null, 7)).toBe("MTH-0007");
    expect(questionCode("Home Economics", null, 1)).toBe("HEO-0001");
    expect(questionCode("French", "fre", 3)).toBe("FRE-0003");
  });
});

describe("plainText", () => {
  it("makes maths readable in lists", async () => {
    const { plainText } = await import("./labels");
    expect(plainText(String.raw`Evaluate $\frac{3}{4} + \frac{1}{6}$.`)).toBe("Evaluate 3/4 + 1/6.");
    expect(plainText(String.raw`Simplify $2^{3} \times 2^{4}$.`)).toBe("Simplify 2³ × 2⁴.");
    expect(plainText(String.raw`is $1.0 \times 10^{-3}$ mol`)).toBe("is 1.0 × 10⁻³ mol");
    expect(plainText(String.raw`formula $\ce{H2SO4}$`)).toBe("formula H₂SO₄");
    expect(plainText(String.raw`angle $90^{\circ}$`)).toBe("angle 90°");
  });
});
