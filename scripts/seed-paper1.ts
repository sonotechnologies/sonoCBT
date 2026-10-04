/**
 * JSS3 Mock · Paper 1, exactly as in the exam runtime design: an English
 * comprehension passage, English, Mathematics and Basic Science objectives, and
 * two theory questions. Added to the bank as approved questions, then published
 * through the real exam builder so the runtime reads the same data a school's
 * exam would.
 */
import { eq } from "drizzle-orm";
import type { Actor } from "@/lib/auth/permissions";
import * as t from "@/lib/db/schema";
import { publishExam } from "@/lib/exams/builder";
import type { QuestionInput } from "@/lib/questions/model";
import { addQuestions, savePassage } from "@/lib/questions/service";
import type { TenantScope } from "@/lib/tenant/scope";

type Doc = t.RichDoc;
const para = (s: string) => ({
  type: "paragraph",
  content: s
    .split(/\$([^$]+)\$/)
    .map((part, i) => (i % 2 ? { type: "inlineMath", attrs: { latex: part } } : part ? { type: "text", text: part } : null))
    .filter(Boolean),
});
const doc = (...paras: string[]): Doc => ({ type: "doc", content: paras.map(para) });

const PASSAGE = [
  "Every December, when the harmattan wind begins to blow dust across the town, Mama Tolu moves her stall from the corner of the market to the shade of the old iroko tree. She sells groundnuts, roasted corn and small bags of tiger nuts, and she knows most of her customers by name.",
  "This year, the market association announced that the iroko tree would be cut down to make room for a new row of lock-up shops. Traders argued for weeks. Some wanted the modern shops, with doors that could be locked at night. Others, like Mama Tolu, said the tree was older than the market itself and that its shade was worth more than any roof.",
  "In the end, the association reached a compromise. The shops would be built along the eastern wall, and the tree would stay. On the morning the decision was read out, Mama Tolu arrived early, swept the ground beneath the branches, and gave every child who passed a handful of groundnuts for free.",
];

// [stem, options, index of the correct option, topic, difficulty]
type Obj = [string, string[], number, string, "easy" | "medium" | "hard"];

const ENGLISH_PASSAGE: Obj[] = [
  ["Why does Mama Tolu move her stall every December?", ["To be closer to her customers", "To find shade from the harmattan", "Because the association asks her to", "To make room for new shops"], 1, "Comprehension", "easy"],
  ["The traders who supported the new shops wanted them mainly because the shops", ["would be cheaper to rent", "could be locked at night", "were closer to the road", "had more space for goods"], 1, "Comprehension", "easy"],
  ["The word “compromise”, as used in the passage, means", ["a decision that gives each side part of what it wants", "a rule made by the oldest traders", "a delay in making a decision", "a complete victory for one group"], 0, "Comprehension", "medium"],
  ["What does Mama Tolu’s action on the last morning suggest about her?", ["She was worried about losing customers", "She wanted to sell more groundnuts", "She was pleased with the outcome", "She disagreed with the association"], 2, "Comprehension", "medium"],
  ["Which title best suits the passage?", ["The New Lock-up Shops", "A Tree Worth Keeping", "Selling Groundnuts in December", "The Market Association Meeting"], 1, "Comprehension", "medium"],
];
const ENGLISH: Obj[] = [
  ["Choose the option nearest in meaning to the word in quotes: The principal gave a “candid” account of the incident.", ["brief", "honest", "confusing", "angry"], 1, "Vocabulary", "medium"],
  ["Choose the option opposite in meaning to the word in quotes: The hall was “congested” on prize-giving day.", ["noisy", "decorated", "spacious", "crowded"], 2, "Vocabulary", "easy"],
  ["Choose the option that best fills the gap: Neither the teacher nor the students ___ aware of the change.", ["was", "is", "were", "has been"], 2, "Concord", "hard"],
];
const MATHS: Obj[] = [
  ["Simplify $\\frac{2}{3} + \\frac{3}{4}$.", ["$\\frac{5}{7}$", "$\\frac{17}{12}$", "$\\frac{5}{12}$", "$1\\frac{1}{4}$"], 1, "Fractions", "easy"],
  ["Solve for $x$: $3x - 7 = 11$.", ["$x = 4$", "$x = 6$", "$x = \\frac{4}{3}$", "$x = 18$"], 1, "Simple equations", "easy"],
  ["Evaluate $2^{3} \\times 2^{-1}$.", ["2", "4", "8", "16"], 1, "Indices", "medium"],
  ["Express 0.000345 in standard form.", ["$3.45 \\times 10^{-4}$", "$3.45 \\times 10^{4}$", "$34.5 \\times 10^{-5}$", "$0.345 \\times 10^{-3}$"], 0, "Standard form", "medium"],
  ["Triangle $PQR$ is right-angled at $Q$. If $PQ = 6\\text{ cm}$ and $QR = 8\\text{ cm}$, find the length of $PR$.", ["10 cm", "12 cm", "14 cm", "48 cm"], 0, "Pythagoras", "medium"],
  ["Find the value of $x$ if $\\sqrt{x + 5} = 4$.", ["11", "9", "21", "−1"], 0, "Simple equations", "medium"],
  ["A trader bought a bag of rice for ₦45,000 and sold it for ₦51,750. What was her percentage profit?", ["12%", "13.5%", "15%", "6.75%"], 2, "Profit and loss", "medium"],
  ["Factorise $x^{2} - 5x + 6$.", ["$(x-2)(x-3)$", "$(x+2)(x+3)$", "$(x-1)(x-6)$", "$(x+1)(x-6)$"], 0, "Factorisation", "medium"],
  ["The mean of 4, 7, 9, $y$ and 10 is 8. Find $y$.", ["8", "9", "10", "12"], 2, "Statistics", "easy"],
  ["Convert $101101_{2}$ to a number in base ten.", ["43", "45", "47", "90"], 1, "Number bases", "medium"],
  ["Given that $\\log_{10} 2 = 0.3010$, find $\\log_{10} 8$.", ["0.9030", "0.6020", "2.4080", "0.0903"], 0, "Logarithms", "hard"],
  ["Find the gradient of the line joining $(2, 3)$ and $(6, 11)$.", ["2", "$\\frac{1}{2}$", "4", "8"], 0, "Coordinate geometry", "medium"],
];
const SCIENCE: Obj[] = [
  ["Which part of a plant cell controls the activities of the cell?", ["Cell wall", "Nucleus", "Vacuole", "Chloroplast"], 1, "Living things", "easy"],
  ["The SI unit of force is the", ["joule", "watt", "newton", "pascal"], 2, "Force", "easy"],
  ["Which of these is a non-renewable source of energy?", ["Solar", "Wind", "Crude oil", "Hydro"], 2, "Energy", "easy"],
  ["At sea level, pure water boils at", ["$50^{\\circ}\\text{C}$", "$90^{\\circ}\\text{C}$", "$100^{\\circ}\\text{C}$", "$212^{\\circ}\\text{C}$"], 2, "States of matter", "easy"],
  ["The process by which green plants make their food is called", ["respiration", "transpiration", "photosynthesis", "digestion"], 2, "Living things", "easy"],
  ["Which of the following is a mixture?", ["Salt solution", "Distilled water", "Oxygen", "Sodium"], 0, "Matter", "medium"],
  ["A body moves 120 m in 20 s. What is its average speed?", ["$6\\text{ m/s}$", "$0.17\\text{ m/s}$", "$140\\text{ m/s}$", "$2400\\text{ m/s}$"], 0, "Motion", "medium"],
  ["Malaria is transmitted by the female", ["tsetse fly", "housefly", "Anopheles mosquito", "Culex mosquito"], 2, "Health", "easy"],
];

export async function seedPaperOne(
  scope: TenantScope,
  admin: Actor,
  o: { examId: string; subjects: Record<string, string>; jss3: string; now: Date; seats: Record<string, string> },
) {
  const base = (subjectId: string): QuestionInput => ({
    type: "mcq_single",
    subjectId,
    classLevelId: o.jss3,
    topicName: "",
    passageId: null,
    stem: doc(""),
    marks: 1,
    difficulty: "medium",
    options: [],
    scoring: "all_or_nothing",
    trueFalse: null,
    accepted: [],
    caseSensitive: false,
    numericValue: "",
    tolerance: "",
    markingGuide: null,
  });
  const obj = (subjectId: string, passageId: string | null) => ([stem, opts, right, topicName, difficulty]: Obj) => ({
    input: { ...base(subjectId), passageId, topicName, difficulty, stem: doc(stem), options: opts.map((x, i) => ({ content: doc(x), isCorrect: i === right })) },
  });
  const add = async (subjectId: string, items: { input: QuestionInput }[]) => {
    const res = await addQuestions(scope, admin, { subjectId, submit: true, source: "manual", items });
    return res.map((r) => {
      if (!r.ok) throw new Error(`Paper 1 question failed: ${JSON.stringify(r)}`);
      return r.id;
    });
  };

  const english = o.subjects["English Language"];
  const maths = o.subjects.Mathematics;
  const science = o.subjects["Basic Science"];
  const passage = await savePassage(scope, admin, { subjectId: english, classLevelId: o.jss3, title: "The Harmattan Market", content: doc(...PASSAGE) });

  const ids = {
    english: [...(await add(english, ENGLISH_PASSAGE.map(obj(english, passage.id)))), ...(await add(english, ENGLISH.map(obj(english, null))))],
    maths: await add(maths, MATHS.map(obj(maths, null))),
    science: await add(science, SCIENCE.map(obj(science, null))),
    theory: [
      ...(await add(science, [
        {
          input: {
            ...base(science),
            type: "theory",
            marks: 10,
            topicName: "Health",
            stem: doc("Explain three ways a school can reduce the spread of malaria among its students."),
            markingGuide: doc(
              "Any three, well explained (3 marks each, +1 for clear writing): clear stagnant water and blocked gutters; insecticide-treated nets for boarders; cut grass and bushes around the compound; screen windows and doors; spray insecticide; teach students to seek treatment early.",
            ),
          },
        },
      ])),
      ...(await add(maths, [
        {
          input: {
            ...base(maths),
            type: "theory",
            marks: 10,
            difficulty: "hard",
            topicName: "Simultaneous equations",
            stem: doc("Solve the simultaneous equations $2x + y = 7$ and $x - y = 2$. Show all your working."),
            markingGuide: doc("Adds the equations: $3x = 9$ (3). $x = 3$ (2). Substitutes: $y = 1$ (3). Checks in both equations (2)."),
          },
        },
      ])),
    ],
  };

  const sections = [
    ["English", english, ids.english],
    ["Mathematics", maths, ids.maths],
    ["Basic Science", science, ids.science],
    ["Theory", null, ids.theory],
  ] as const;
  for (const [i, [title, subjectId, qIds]] of sections.entries()) {
    const [sec] = await scope.insert(t.examSection, { examId: o.examId, title, subjectId, sortOrder: i + 1, questionCount: qIds.length, marks: 0 });
    await scope.insert(t.examSectionItem, qIds.map((questionId, n) => ({ examId: o.examId, sectionId: sec.id, questionId, sortOrder: n + 1 })));
  }
  await publishExam(scope, admin, o.examId, { now: o.now, seed: "paper-1" });
  // Seats from the design (Chiamaka sits at 14).
  for (const [studentId, seat] of Object.entries(o.seats)) {
    await scope.update(t.examCandidate, { seat }, eq(t.examCandidate.studentId, studentId));
  }
}
