/**
 * Builds the Word import fixtures in lib/import/fixtures: ten question papers,
 * each typed the way Nigerian teachers commonly type them, plus the expected
 * parse for every question. Run: npx tsx scripts/make-import-fixtures.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AlignmentType,
  Document,
  ImageRun,
  LevelFormat,
  Math as OMath,
  MathFraction,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSuperScript,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  type IRunOptions,
  type ParagraphChild,
} from "docx";

export type Expected = {
  n: number;
  type: "mcq_single" | "mcq_multi" | "true_false" | "fill_blank" | "numeric" | "theory";
  /** Text the stem must contain (case-insensitive; maths as LaTeX between $). */
  stem: string;
  options?: number;
  correct?: string;
  tf?: boolean;
  accepted?: string;
  numeric?: string;
  marks?: number;
  passage?: boolean;
  /** Default "green": parsed right with nothing to fix. */
  confidence?: "green" | "amber" | "red";
};

const OUT = path.join(process.cwd(), "lib/import/fixtures");

const t = (text: string, o: Omit<IRunOptions, "text"> = {}) => new TextRun({ text, ...o });
const P = (...children: (ParagraphChild | string)[]) => new Paragraph({ children: children.map((c) => (typeof c === "string" ? t(c) : c)) });
const blank = () => P("");

function header(school: string, exam: string, extra: string[] = []) {
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [t(school.toUpperCase(), { bold: true, size: 28 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [t(exam, { bold: true })] }),
    ...extra.map((e) => P(e)),
    blank(),
  ];
}

async function save(name: string, children: (Paragraph | Table)[], expected: Expected[], numbering?: ConstructorParameters<typeof Document>[0]["numbering"]) {
  const doc = new Document({ numbering, sections: [{ children }] });
  await writeFile(path.join(OUT, `${name}.docx`), await Packer.toBuffer(doc));
  await writeFile(path.join(OUT, `${name}.expected.json`), JSON.stringify(expected, null, 2) + "\n");
}

// A tiny valid PNG (1×1) for image questions.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function main() {
  await mkdir(OUT, { recursive: true });

  // 01 · Classic: numbered stems, options on their own lines, "Ans:" after each question.
  {
    const qs: [string, string[], string][] = [
      ["Which of the following is an alkali metal?", ["Calcium", "Sodium", "Aluminium", "Iron"], "B"],
      ["The chemical symbol for potassium is", ["P", "Po", "K", "Pt"], "C"],
      ["Which gas turns lime water milky?", ["Oxygen", "Hydrogen", "Carbon(IV) oxide", "Nitrogen"], "C"],
      ["An example of a physical change is", ["rusting of iron", "burning of paper", "melting of ice", "souring of milk"], "C"],
      ["The process by which plants make food is called", ["respiration", "photosynthesis", "transpiration", "digestion"], "B"],
      ["Which of these is a noble gas?", ["Chlorine", "Argon", "Nitrogen", "Fluorine"], "B"],
      ["Water boils at ____ °C at sea level.", ["90", "100", "110", "120"], "B"],
      ["Which organ pumps blood round the body?", ["Lungs", "Kidney", "Heart", "Liver"], "C"],
    ];
    const children = [...header("Greenfield Academy, Lekki", "First Term Examination · Basic Science · JSS3", ["Time: 1 hour", "Instructions: Answer all questions."])];
    const expected: Expected[] = [];
    qs.forEach(([stem, opts, ans], i) => {
      children.push(P(`${i + 1}. ${stem}`));
      opts.forEach((o, j) => children.push(P(`${"ABCD"[j]}. ${o}`)));
      children.push(P(`Ans: ${ans}`), blank());
      expected.push({ n: i + 1, type: "mcq_single", stem, options: 4, correct: ans });
    });
    await save("01-classic-ans-lines", children, expected);
  }

  // 02 · Inline options on one line; answer key block at the end.
  {
    const qs: [string, string, string][] = [
      ["The capital of Nigeria is", "(a) Lagos   (b) Abuja   (c) Kano   (d) Ibadan", "B"],
      ["The first president of Nigeria was", "(a) Nnamdi Azikiwe   (b) Obafemi Awolowo   (c) Tafawa Balewa   (d) Ahmadu Bello", "A"],
      ["Nigeria became a republic in", "(a) 1960   (b) 1963   (c) 1966   (d) 1979", "B"],
      ["The longest river in Nigeria is the River", "(a) Benue   (b) Niger   (c) Ogun   (d) Cross", "B"],
      ["Which of these is a traditional ruler in Yorubaland?", "(a) Emir   (b) Obi   (c) Oba   (d) Shehu", "C"],
      ["The colour of the Nigerian flag is", "(a) green and white   (b) red and green   (c) white and blue   (d) green and yellow", "A"],
      ["Civic education teaches us our rights and", "(a) games   (b) duties   (c) songs   (d) prayers", "B"],
      ["A citizen who is loyal to his country is", "(a) patriotic   (b) selfish   (c) lazy   (d) corrupt", "A"],
      ["The arm of government that makes laws is the", "(a) executive   (b) judiciary   (c) legislature   (d) police", "C"],
      ["Corruption can be reduced by", "(a) bribery   (b) accountability   (c) nepotism   (d) fraud", "B"],
    ];
    const children = [...header("Crestview Model College, Ibadan", "Second Term Test · Social Studies & Civic · JSS2")];
    const expected: Expected[] = [];
    qs.forEach(([stem, opts, ans], i) => {
      children.push(P(`${i + 1}. ${stem}`), P(opts));
      expected.push({ n: i + 1, type: "mcq_single", stem, options: 4, correct: ans });
    });
    children.push(blank(), P(t("ANSWERS", { bold: true })), P(qs.slice(0, 5).map(([, , a], i) => `${i + 1}. ${a}`).join("   ")), P(qs.slice(5).map(([, , a], i) => `${i + 6}. ${a}`).join("   ")));
    await save("02-inline-options-answer-key", children, expected);
  }

  // 03 · Correct option in bold; options "a)" style.
  {
    const qs: [string, string[], number][] = [
      ["The plural of 'child' is", ["childs", "children", "childrens", "childes"], 1],
      ["Choose the word that is opposite in meaning to 'generous'.", ["kind", "mean", "rich", "happy"], 1],
      ["She ____ to school every day.", ["go", "goes", "going", "gone"], 1],
      ["Which of these is a noun?", ["quickly", "beautiful", "Lagos", "run"], 2],
      ["The past tense of 'eat' is", ["eated", "ate", "eaten", "eating"], 1],
      ["Choose the correctly spelt word.", ["recieve", "receive", "receeve", "riceive"], 1],
      ["A group of cattle is called a", ["herd", "flock", "pack", "swarm"], 0],
      ["'He is as brave as a lion' is an example of", ["metaphor", "simile", "irony", "personification"], 1],
    ];
    const children = [...header("Greenfield Academy", "English Language · Mid-term test")];
    const expected: Expected[] = [];
    qs.forEach(([stem, opts, ans], i) => {
      children.push(P(`${i + 1}. ${stem}`));
      opts.forEach((o, j) => children.push(P(t(`${"abcd"[j]}) ${o}`, { bold: j === ans }))));
      expected.push({ n: i + 1, type: "mcq_single", stem, options: 4, correct: "ABCD"[ans] });
    });
    await save("03-bold-answers", children, expected);
  }

  // 04 · Word automatic numbering (1. / a.) with the answer underlined.
  {
    const qs: [string, string[], number][] = [
      ["The main source of energy for the earth is the", ["moon", "sun", "wind", "sea"], 1],
      ["Which part of a plant absorbs water?", ["leaf", "stem", "root", "flower"], 2],
      ["An animal that feeds on both plants and animals is a", ["herbivore", "carnivore", "omnivore", "producer"], 2],
      ["Malaria is transmitted by the", ["housefly", "female anopheles mosquito", "tsetse fly", "cockroach"], 1],
      ["Which of these is a renewable resource?", ["coal", "crude oil", "solar energy", "natural gas"], 2],
      ["The unit of force is the", ["joule", "newton", "watt", "metre"], 1],
      ["Which blood cells fight infection?", ["red blood cells", "white blood cells", "platelets", "plasma"], 1],
      ["Rusting requires air and", ["heat", "water", "light", "sand"], 1],
      ["The boiling point of pure water is", ["0 °C", "50 °C", "100 °C", "212 °C"], 2],
    ];
    const children: Paragraph[] = [...header("Greenfield Academy", "Basic Science · Weekly test")];
    const expected: Expected[] = [];
    qs.forEach(([stem, opts, ans], i) => {
      children.push(new Paragraph({ numbering: { reference: "paper", level: 0 }, children: [t(stem)] }));
      opts.forEach((o, j) => children.push(new Paragraph({ numbering: { reference: "paper", level: 1 }, children: [t(o, { underline: j === ans ? {} : undefined })] })));
      expected.push({ n: i + 1, type: "mcq_single", stem, options: 4, correct: "ABCD"[ans] });
    });
    await save("04-word-auto-numbering", children, expected, {
      config: [
        {
          reference: "paper",
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START },
            { level: 1, format: LevelFormat.LOWER_LETTER, text: "%2.", alignment: AlignmentType.START },
          ],
        },
      ],
    });
  }

  // 05 · "Q1." style with the answer key in a table.
  {
    const qs: [string, string[], string][] = [
      ["Which of these is an input device?", ["Monitor", "Printer", "Keyboard", "Speaker"], "C"],
      ["The brain of the computer is the", ["RAM", "CPU", "hard disk", "mouse"], "B"],
      ["Which of these is an operating system?", ["Windows", "Excel", "Chrome", "Word"], "A"],
      ["1 kilobyte is equal to", ["100 bytes", "1000 bits", "1024 bytes", "1024 kilobits"], "C"],
      ["A program used to browse the internet is a", ["browser", "compiler", "spreadsheet", "virus"], "A"],
      ["Which key is used to delete characters to the left of the cursor?", ["Delete", "Backspace", "Shift", "Tab"], "B"],
      ["Which of these stores data permanently?", ["RAM", "Cache", "Hard disk", "Register"], "C"],
      ["The full meaning of ICT is Information and Communication", ["Technique", "Technology", "Telephone", "Transfer"], "B"],
    ];
    const children: (Paragraph | Table)[] = [...header("Crestview Model College", "Computer Studies · SS1 · Continuous Assessment")];
    const expected: Expected[] = [];
    qs.forEach(([stem, opts, ans], i) => {
      children.push(P(`Q${i + 1}. ${stem}`));
      opts.forEach((o, j) => children.push(P(`${"ABCD"[j]}) ${o}`)));
      expected.push({ n: i + 1, type: "mcq_single", stem, options: 4, correct: ans });
    });
    children.push(blank(), P(t("Answer key", { bold: true })));
    const cell = (s: string) => new TableCell({ children: [P(s)] });
    children.push(
      new Table({
        rows: [0, 1, 2, 3].map((r) => new TableRow({ children: [cell(String(r + 1)), cell(qs[r][2]), cell(String(r + 5)), cell(qs[r + 4][2])] })),
      }),
    );
    await save("05-answer-key-table", children, expected);
  }

  // 06 · Section A objectives (answers starred), Section B theory with sub-parts and marks.
  {
    const children = [...header("Greenfield Academy", "Mathematics · JSS3 · Third Term Examination", ["Duration: 2 hours"])];
    const expected: Expected[] = [];
    children.push(P(t("SECTION A: OBJECTIVES", { bold: true })), P("Answer all questions in this section."));
    const obj: [string, string[], number][] = [
      ["Simplify 3 + 4 × 2.", ["14", "11", "10", "24"], 1],
      ["What is 25% of 80?", ["15", "20", "25", "40"], 1],
      ["The next prime number after 7 is", ["8", "9", "11", "13"], 2],
      ["Express 0.75 as a fraction.", ["1/4", "1/2", "3/4", "2/3"], 2],
      ["How many sides has a hexagon?", ["5", "6", "7", "8"], 1],
      ["The LCM of 4 and 6 is", ["2", "10", "12", "24"], 2],
    ];
    obj.forEach(([stem, opts, ans], i) => {
      children.push(P(`${i + 1}. ${stem}`));
      opts.forEach((o, j) => children.push(P(`${"ABCD"[j]}. ${o}${j === ans ? "*" : ""}`)));
      expected.push({ n: i + 1, type: "mcq_single", stem, options: 4, correct: "ABCD"[ans] });
    });
    children.push(blank(), P(t("SECTION B: THEORY", { bold: true })), P("Answer any two questions."));
    children.push(P("7. (a) Solve the equation 2x + 5 = 17. (3 marks)"), P("(b) Check your answer. (2 marks)"));
    expected.push({ n: 7, type: "theory", stem: "Solve the equation 2x + 5 = 17", marks: 5 });
    children.push(P("8. A trader bought a bag of rice for ₦40,000 and sold it for ₦46,000. Calculate the percentage profit. (5 marks)"));
    expected.push({ n: 8, type: "theory", stem: "Calculate the percentage profit", marks: 5 });
    children.push(P("9. (a) Define a prime number."), P("(b) List all the prime numbers between 10 and 30. [4 marks]"));
    expected.push({ n: 9, type: "theory", stem: "Define a prime number", marks: 4 });
    await save("06-sections-theory", children, expected);
  }

  // 07 · Comprehension passage, then more questions.
  {
    const children = [...header("Greenfield Academy", "English Language · JSS2")];
    const expected: Expected[] = [];
    children.push(P(t("Read the passage below carefully and answer questions 1 to 4.", { italics: true })));
    children.push(P(t("Market Day in Oyo", { bold: true })));
    children.push(
      P("Every fifth day, the market square in Oyo comes alive. Traders arrive before dawn with baskets of yam, pepper and cloth. Mama Tunde sells akara beside the old iroko tree, and her customers queue even in the rain."),
      P("By noon the square is crowded. Children run errands for their parents while elders sit under the shade and discuss the price of cocoa."),
    );
    const comp: [string, string[], string][] = [
      ["How often is the market held?", ["every day", "every fifth day", "every Sunday", "once a month"], "B"],
      ["What does Mama Tunde sell?", ["yam", "pepper", "akara", "cloth"], "C"],
      ["Where does Mama Tunde sell?", ["beside the iroko tree", "in her house", "at the school", "by the river"], "A"],
      ["What do the elders discuss?", ["politics", "the price of cocoa", "football", "the weather"], "B"],
    ];
    comp.forEach(([stem, opts, ans], i) => {
      children.push(P(`${i + 1}. ${stem}`));
      opts.forEach((o, j) => children.push(P(`${"ABCD"[j]}. ${o}`)));
      children.push(P(`Answer: ${ans}`));
      expected.push({ n: i + 1, type: "mcq_single", stem, options: 4, correct: ans, passage: true });
    });
    children.push(blank(), P(t("SECTION B: Vocabulary", { bold: true })));
    const vocab: [string, string[], string][] = [
      ["Choose the word nearest in meaning to 'crowded'.", ["empty", "full", "quiet", "clean"], "B"],
      ["Choose the word opposite in meaning to 'dawn'.", ["morning", "dusk", "noon", "day"], "B"],
      ["An 'errand' is a", ["short journey to do a task", "kind of food", "type of tree", "game"], "A"],
    ];
    vocab.forEach(([stem, opts, ans], i) => {
      children.push(P(`${i + 5}. ${stem}`));
      opts.forEach((o, j) => children.push(P(`${"ABCD"[j]}. ${o}`)));
      children.push(P(`Answer: ${ans}`));
      expected.push({ n: i + 5, type: "mcq_single", stem, options: 4, correct: ans });
    });
    await save("07-comprehension-passage", children, expected);
  }

  // 08 · Word equations (fractions, powers, roots) in stems and options.
  {
    const children = [...header("Greenfield Academy", "Mathematics · SS1")];
    const expected: Expected[] = [];
    const frac = (a: string, b: string) => new MathFraction({ numerator: [new MathRun(a)], denominator: [new MathRun(b)] });
    const pow = (a: string, b: string) => new MathSuperScript({ children: [new MathRun(a)], superScript: [new MathRun(b)] });
    const math = (...c: ConstructorParameters<typeof OMath>[0]["children"]) => new OMath({ children: c });
    const add = (n: number, stem: ParagraphChild[], opts: ParagraphChild[][], ans: string, exp: Expected) => {
      children.push(new Paragraph({ children: [t(`${n}. `), ...stem] }));
      opts.forEach((o, j) => children.push(new Paragraph({ children: [t(`${"ABCD"[j]}. `), ...o] })));
      children.push(P(`Answer: ${ans}`));
      expected.push(exp);
    };
    add(1, [t("Simplify "), math(frac("3", "4"), new MathRun("+"), frac("1", "6"))], [[math(frac("4", "10"))], [math(frac("11", "12"))], [math(frac("2", "5"))], [math(frac("5", "6"))]], "B", {
      n: 1, type: "mcq_single", stem: "\\frac{3}{4}+\\frac{1}{6}", options: 4, correct: "B",
    });
    add(2, [t("Evaluate "), math(pow("2", "3"), new MathRun("×"), pow("2", "2"))], [[math(pow("2", "5"))], [math(pow("2", "6"))], [math(pow("4", "5"))], [math(pow("4", "6"))]], "A", {
      n: 2, type: "mcq_single", stem: "{2}^{3}\\times {2}^{2}", options: 4, correct: "A",
    });
    add(3, [t("Find the value of "), math(new MathRadical({ children: [new MathRun("144")] }))], [[t("11")], [t("12")], [t("14")], [t("72")]], "B", {
      n: 3, type: "mcq_single", stem: "\\sqrt{144}", options: 4, correct: "B",
    });
    add(4, [t("If "), math(new MathRun("x"), new MathRun("="), frac("1", "2")), t(", find "), math(pow("x", "2"))], [[math(frac("1", "4"))], [math(frac("1", "2"))], [t("1")], [t("2")]], "A", {
      n: 4, type: "mcq_single", stem: "x=\\frac{1}{2}", options: 4, correct: "A",
    });
    add(5, [t("The formula for water is "), math(new MathSubScript({ children: [new MathRun("H")], subScript: [new MathRun("2")] }), new MathRun("O")), t(". How many hydrogen atoms are in one molecule?")], [[t("1")], [t("2")], [t("3")], [t("4")]], "B", {
      n: 5, type: "mcq_single", stem: "{H}_{2}O", options: 4, correct: "B",
    });
    add(6, [t("Solve for y: "), math(new MathRun("3y"), new MathRun("−"), new MathRun("4"), new MathRun("="), new MathRun("11"))], [[t("3")], [t("5")], [t("7")], [t("15")]], "B", {
      n: 6, type: "mcq_single", stem: "3y-4=11", options: 4, correct: "B",
    });
    await save("08-word-equations", children, expected);
  }

  // 09 · Messy header, "Question 1" numbering, highlighted answers, gap-fills with Ans text.
  {
    const children = [
      ...header("Greenfield Academy, Lekki · Knowledge, Discipline and Service", "SECOND TERM EXAMINATION 2025/2026", [
        "Subject: Agricultural Science        Class: JSS1",
        "Name: ______________________        Admission No: __________",
        "Instructions: Answer ALL questions. Time: 1hr 30mins",
      ]),
    ];
    const expected: Expected[] = [];
    const mcq: [string, string[], number][] = [
      ["Which of these is a farm tool?", ["cutlass", "pencil", "spoon", "comb"], 0],
      ["Which of these animals is kept for eggs?", ["goat", "poultry", "cattle", "pig"], 1],
      ["The best soil for farming is", ["sandy soil", "clay soil", "loamy soil", "rocky soil"], 2],
      ["Which of these is a cash crop?", ["cocoa", "grass", "weed", "sand"], 0],
      ["Planting the same crop year after year on a piece of land leads to", ["high yield", "soil exhaustion", "more rain", "fewer pests"], 1],
    ];
    mcq.forEach(([stem, opts, ans], i) => {
      children.push(P(`Question ${i + 1}: ${stem}`));
      opts.forEach((o, j) => children.push(P(t(`(${"abcd"[j]}) ${o}`, { highlight: j === ans ? "yellow" : undefined }))));
      expected.push({ n: i + 1, type: "mcq_single", stem, options: 4, correct: "ABCD"[ans] });
    });
    const gaps: [string, string][] = [
      ["The removal of weeds from a farm is called ______.", "weeding"],
      ["A young cow is called a ______.", "calf"],
      ["The practice of growing crops and rearing animals together is ______ farming.", "mixed"],
    ];
    children.push(blank(), P(t("SECTION B: Fill in the gaps", { bold: true })));
    gaps.forEach(([stem, ans], i) => {
      children.push(P(`Question ${i + 6}: ${stem}`), P(`Ans: ${ans}`));
      expected.push({ n: i + 6, type: "fill_blank", stem: stem.replace(/_+/, "").split(" ").slice(0, 4).join(" "), accepted: ans });
    });
    await save("09-header-highlight-gaps", children, expected);
  }

  // 10 · Mixed: "(1)" numbering, "A)" options, "(B)" after the stem, true/false, numeric, subscripts, an image.
  {
    const children = [...header("Crestview Model College", "Basic Science & Technology · JSS3 · Mock")];
    const expected: Expected[] = [];
    const q = (n: number, stem: (string | TextRun)[], opts: string[] | null, after: string | null) => {
      children.push(P(`(${n}) `, ...stem));
      if (opts) children.push(P(opts.map((o, j) => `${"ABCD"[j]}) ${o}`).join("    ")));
      if (after) children.push(P(after));
    };
    q(1, ["Which of these is a conductor of electricity? (B)"], ["rubber", "copper", "wood", "plastic"], null);
    expected.push({ n: 1, type: "mcq_single", stem: "conductor of electricity", options: 4, correct: "B" });
    q(2, ["The formula of carbon(IV) oxide is CO", t("2", { subScript: true }), ". What is its relative molecular mass? (C=12, O=16) (C)"], ["28", "32", "44", "48"], null);
    expected.push({ n: 2, type: "mcq_single", stem: "relative molecular mass", options: 4, correct: "C" });
    q(3, ["True or False: Sound travels faster than light."], null, "Answer: False");
    expected.push({ n: 3, type: "true_false", stem: "Sound travels faster than light", tf: false });
    q(4, ["State whether the statement is true or false: Plants give out oxygen during photosynthesis."], ["True", "False"], "Ans: A");
    expected.push({ n: 4, type: "true_false", stem: "Plants give out oxygen", tf: true });
    q(5, ["A car travels 120 km in 2 hours. What is its average speed in km/h?"], null, "Answer: 60");
    expected.push({ n: 5, type: "numeric", stem: "average speed", numeric: "60" });
    children.push(P("(6) The apparatus shown below is used for"));
    children.push(new Paragraph({ children: [new ImageRun({ type: "png", data: PNG, transformation: { width: 40, height: 40 } })] }));
    children.push(P("A) filtration    B) distillation    C) evaporation    D) sublimation"), P("Ans: B"));
    expected.push({ n: 6, type: "mcq_single", stem: "apparatus shown below", options: 4, correct: "B" });
    q(7, ["Which of these is NOT a simple machine?"], ["lever", "pulley", "inclined plane", "generator"], "Answer: D");
    expected.push({ n: 7, type: "mcq_single", stem: "NOT a simple machine", options: 4, correct: "D" });
    // No answer given anywhere: should be flagged, not guessed.
    q(8, ["The SI unit of power is the"], ["joule", "newton", "watt", "ampere"], null);
    expected.push({ n: 8, type: "mcq_single", stem: "SI unit of power", options: 4, correct: "", confidence: "amber" });
    await save("10-mixed-styles", children, expected);
  }

  console.info(`Fixtures written to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
