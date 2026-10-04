/**
 * Two finished CA tests with every candidate's answers, so the analytics
 * screens have real data: Mathematics CA test 1 (JSS3A and JSS3B) and English
 * CA test 1 (JSS3B). Questions go into the bank as approved and the exams are
 * published through the real builder; answers are simulated deterministically
 * (each class has a couple of weak topics, and each question a tempting wrong
 * option) and marked by the same server-side marking the runtime uses.
 */
import { eq } from "drizzle-orm";
import type { Actor } from "@/lib/auth/permissions";
import * as t from "@/lib/db/schema";
import { publishExam } from "@/lib/exams/builder";
import { markResponse } from "@/lib/exams/rules";
import { refreshQuestionStats } from "@/lib/analytics/stats";
import type { QuestionInput } from "@/lib/questions/model";
import { addQuestions } from "@/lib/questions/service";
import type { TenantScope } from "@/lib/tenant/scope";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const para = (s: string) => ({
  type: "paragraph",
  content: s
    .split(/\$([^$]+)\$/)
    .map((part, i) => (i % 2 ? { type: "inlineMath", attrs: { latex: part } } : part ? { type: "text", text: part } : null))
    .filter(Boolean),
});
const doc = (s: string): t.RichDoc => ({ type: "doc", content: [para(s)] });

// [stem, options, correct index, topic, difficulty, the wrong option most students fall for]
type Q = [string, string[], number, string, "easy" | "medium" | "hard", number];

const MATHS: Q[] = [
  ["Simplify $2^{3} \\times 2^{4}$.", ["$2^{7}$", "$2^{12}$", "$4^{7}$", "$4^{12}$"], 0, "Indices", "easy", 1],
  ["Evaluate $8^{\\frac{2}{3}}$.", ["4", "16", "$\\frac{16}{3}$", "2"], 0, "Indices", "hard", 2],
  ["Simplify $\\frac{a^{5}}{a^{-2}}$.", ["$a^{3}$", "$a^{7}$", "$a^{-10}$", "$a^{10}$"], 1, "Indices", "medium", 0],
  ["Evaluate $\\frac{3}{4} + \\frac{1}{6}$.", ["$\\frac{4}{10}$", "$\\frac{11}{12}$", "$\\frac{4}{24}$", "$\\frac{5}{6}$"], 1, "Fractions", "easy", 0],
  ["What is $\\frac{2}{5}$ of 45?", ["9", "18", "22.5", "112.5"], 1, "Fractions", "easy", 0],
  ["Divide $1\\frac{1}{2}$ by $\\frac{3}{4}$.", ["2", "$\\frac{9}{8}$", "$\\frac{1}{2}$", "$1\\frac{1}{8}$"], 0, "Fractions", "medium", 1],
  ["Express 0.00072 in standard form.", ["$7.2 \\times 10^{-4}$", "$7.2 \\times 10^{4}$", "$72 \\times 10^{-5}$", "$0.72 \\times 10^{-3}$"], 0, "Standard form", "medium", 2],
  ["Write $3.5 \\times 10^{3}$ as an ordinary number.", ["350", "3500", "35 000", "0.0035"], 1, "Standard form", "easy", 0],
  ["Given that $\\log_{10} 2 = 0.3010$, find $\\log_{10} 4$.", ["0.6020", "0.0906", "0.9030", "1.3010"], 0, "Logarithms", "hard", 1],
  ["Evaluate $\\log_{2} 32$.", ["5", "16", "6", "2.5"], 0, "Logarithms", "hard", 1],
  ["Simplify $\\log_{10} 50 + \\log_{10} 2$.", ["2", "$\\log_{10} 52$", "100", "1"], 0, "Logarithms", "hard", 1],
  ["Convert $1011_{2}$ to base ten.", ["11", "13", "1011", "9"], 0, "Number bases", "medium", 1],
  ["Convert $25_{10}$ to base two.", ["$11001_{2}$", "$10011_{2}$", "$11010_{2}$", "$10101_{2}$"], 0, "Number bases", "medium", 1],
  ["Factorise $x^{2} - 9$.", ["$(x-3)(x+3)$", "$(x-3)^{2}$", "$(x-9)(x+1)$", "$x(x-9)$"], 0, "Factorisation", "medium", 1],
  ["Factorise $2x^{2} + 6x$.", ["$2x(x + 3)$", "$2(x^{2} + 3x)$", "$x(2x + 3)$", "$2x(x + 6)$"], 0, "Factorisation", "easy", 1],
  ["The mean of 6, 8, 10 and $y$ is 9. Find $y$.", ["12", "9", "8", "36"], 0, "Statistics", "easy", 1],
  ["Find the median of 3, 9, 4, 7, 5.", ["5", "4", "7", "5.6"], 0, "Statistics", "medium", 3],
  ["What is the mode of 2, 3, 3, 5, 7, 3, 5?", ["3", "5", "2", "4"], 0, "Statistics", "easy", 1],
  ["Solve $5x + 3 = 18$.", ["$x = 3$", "$x = 4.2$", "$x = 15$", "$x = 21$"], 0, "Simple equations", "easy", 1],
  ["Solve $\\frac{x}{3} - 2 = 4$.", ["$x = 18$", "$x = 6$", "$x = 2$", "$x = 14$"], 0, "Simple equations", "medium", 1],
];

const ENGLISH: Q[] = [
  ["Choose the word nearest in meaning to “diligent”.", ["hard-working", "clever", "careless", "quiet"], 0, "Vocabulary", "medium", 1],
  ["Choose the word opposite in meaning to “scarce”.", ["rare", "plentiful", "expensive", "small"], 1, "Vocabulary", "easy", 0],
  ["Choose the word nearest in meaning to “reluctant”.", ["unwilling", "eager", "late", "afraid"], 0, "Vocabulary", "medium", 3],
  ["Choose the word opposite in meaning to “ancient”.", ["old", "modern", "broken", "famous"], 1, "Vocabulary", "easy", 0],
  ["Each of the boys ___ a bicycle.", ["have", "has", "are having", "were having"], 1, "Concord", "hard", 0],
  ["The news ___ very encouraging.", ["are", "were", "is", "have been"], 2, "Concord", "hard", 0],
  ["Bread and butter ___ my favourite breakfast.", ["is", "are", "were", "have been"], 0, "Concord", "hard", 1],
  ["One of the girls ___ lost her bag.", ["have", "has", "are", "were"], 1, "Concord", "medium", 0],
  ["Choose the correctly spelt word.", ["accommodation", "acommodation", "accomodation", "acomodation"], 0, "Spelling", "medium", 2],
  ["Choose the correctly spelt word.", ["neccessary", "necessary", "necesary", "nessecary"], 1, "Spelling", "medium", 0],
  ["Choose the correctly spelt word.", ["embarass", "embarrass", "embarras", "emberrass"], 1, "Spelling", "hard", 0],
  ["Which sentence is punctuated correctly?", ["Its raining today.", "It’s raining today.", "Its’ raining today.", "It,s raining today."], 1, "Punctuation", "medium", 0],
  ["Which sentence is punctuated correctly?", ["The boys’ books are on the table.", "The boys book’s are on the table.", "The boy’s books’ are on the table.", "The boys books are on the table."], 0, "Punctuation", "hard", 1],
  ["“The students has gone home.” The error in the sentence is in the word", ["students", "has", "gone", "home"], 1, "Concord", "easy", 0],
  ["The plural of “child” is", ["childs", "children", "childrens", "childes"], 1, "Vocabulary", "easy", 2],
];

/** How much harder a topic is for a class than the question's own difficulty (0 = no extra). */
const WEAK: Record<string, Record<string, number>> = {
  JSS3A: { "Number bases": 0.18, Indices: 0.16, Logarithms: 0.05, Statistics: -0.08 },
  JSS3B: { Logarithms: 0.14, Indices: 0.12, Fractions: -0.1, Concord: 0.12, Spelling: 0.06 },
};
const BASE: Record<Q[4], number> = { easy: 0.28, medium: 0.48, hard: 0.62 };

function prng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

export async function seedCompletedExams(
  scope: TenantScope,
  admin: Actor,
  o: {
    jss3: string;
    subjects: Record<string, string>;
    arms: Record<string, string>;
    exams: { maths: { id: string; windowStart: Date }; english: { id: string; windowStart: Date } };
    /** JSS3B's star student does well, as on her home screen. */
    strong: string[];
  },
) {
  const plan = [
    { key: "maths", exam: o.exams.maths, subject: "Mathematics", items: MATHS, arms: ["JSS3A", "JSS3B"], seed: 31 },
    { key: "english", exam: o.exams.english, subject: "English Language", items: ENGLISH, arms: ["JSS3B"], seed: 47 },
  ];
  for (const p of plan) {
    const subjectId = o.subjects[p.subject];
    const base: Omit<QuestionInput, "stem" | "options" | "topicName" | "difficulty"> = {
      type: "mcq_single",
      subjectId,
      classLevelId: o.jss3,
      passageId: null,
      marks: 1,
      scoring: "all_or_nothing",
      trueFalse: null,
      accepted: [],
      caseSensitive: false,
      numericValue: "",
      tolerance: "",
      markingGuide: null,
    };
    const res = await addQuestions(scope, admin, {
      subjectId,
      submit: true,
      source: "manual",
      items: p.items.map(([stem, opts, right, topicName, difficulty]) => ({
        input: { ...base, topicName, difficulty, stem: doc(stem), options: opts.map((x, i) => ({ content: doc(x), isCorrect: i === right })) },
      })),
    });
    const qIds = res.map((r) => {
      if (!r.ok) throw new Error(`CA test question failed: ${JSON.stringify(r)}`);
      return r.id;
    });

    const examId = p.exam.id;
    for (const arm of p.arms.filter((a) => a !== "JSS3B")) await scope.insert(t.examAssignment, { examId, classArmId: o.arms[arm] });
    const [sec] = await scope.insert(t.examSection, { examId, title: "Objectives", subjectId, sortOrder: 1, questionCount: qIds.length, marks: qIds.length });
    await scope.insert(t.examSectionItem, qIds.map((questionId, n) => ({ examId, sectionId: sec.id, questionId, sortOrder: n + 1 })));
    await publishExam(scope, admin, examId, { now: new Date(p.exam.windowStart.getTime() - DAY), seed: p.key });
    await scope.update(t.exam, { status: "closed" }, eq(t.exam.id, examId));

    const eqs = (await scope.findMany(t.examQuestion, eq(t.examQuestion.examId, examId))).sort((a, b) => a.sortOrder - b.sortOrder);
    const candidates = await scope.findMany(t.examCandidate, eq(t.examCandidate.examId, examId));
    const students = await scope.findMany(t.student);
    const armName = new Map(Object.entries(o.arms).map(([name, id]) => [id, name]));
    const rand = prng(p.seed);
    const z = () => (rand() + rand() + rand() - 1.5) * 1.15; // roughly normal

    const attempts: (typeof t.attempt.$inferInsert)[] = [];
    const answers: { studentId: string; rows: Omit<typeof t.attemptAnswer.$inferInsert, "attemptId" | "schoolId">[] }[] = [];
    const flagged: { studentId: string; times: Date[] }[] = [];
    for (const [n, c] of candidates.entries()) {
      // Two absentees per class.
      if (n % 19 === 7) continue;
      const st = students.find((s) => s.id === c.studentId)!;
      const arm = armName.get(st.classArmId ?? "") ?? "JSS3B";
      const ability = o.strong.includes(st.id) ? 0.86 : (arm === "JSS3A" ? 0.5 : 0.56) + 0.17 * z();
      const started = new Date(p.exam.windowStart.getTime() + (3 + Math.floor(rand() * 8)) * MIN);
      let clock = started.getTime();
      const rows: (typeof answers)[number]["rows"] = [];
      let score = 0;
      for (const [i, q] of eqs.entries()) {
        const [, , , topic, diff, trap] = p.items[i];
        clock += Math.round((25 + rand() * 40 + BASE[diff] * 90) * 1000);
        if (rand() < 0.03) continue; // skipped
        const hard = BASE[diff] + (WEAK[arm]?.[topic] ?? 0);
        const pRight = 1 / (1 + Math.exp(-(ability - hard) * 7));
        const options = q.snapshot.options;
        const right = options.findIndex((x) => x.isCorrect);
        let pick = right;
        if (rand() >= pRight) {
          const wrong = options.map((_, k) => k).filter((k) => k !== right);
          pick = rand() < 0.62 ? trap : wrong[Math.floor(rand() * wrong.length)];
        }
        const response: t.AttemptResponse = { kind: "choice", optionIds: [options[pick].id] };
        const m = markResponse(q.snapshot, q.marks, response);
        score += m.marksAwarded ?? 0;
        rows.push({ examQuestionId: q.id, response, flagged: false, clientSeq: rows.length + 1, answeredAt: new Date(clock), isCorrect: m.isCorrect, marksAwarded: m.marksAwarded });
      }
      const timedOut = n % 13 === 5;
      const deadline = new Date(started.getTime() + 30 * MIN);
      const submittedAt = timedOut ? deadline : new Date(Math.min(clock + 40_000, deadline.getTime() - 30_000));
      const leaves = n % 11 === 3 ? 2 : n % 17 === 9 ? 1 : 0;
      attempts.push({
        schoolId: scope.schoolId,
        examId,
        studentId: st.id,
        startedAt: started,
        deadlineAt: deadline,
        submittedAt,
        status: timedOut ? "auto_submitted" : "submitted",
        submitReason: timedOut ? "timeout" : "student",
        questionOrder: eqs.map((q) => q.id),
        answeredCount: rows.length,
        currentIndex: eqs.length - 1,
        clientSeq: rows.length,
        integrityFlags: leaves,
        leaveCount: leaves,
        score,
        maxScore: eqs.length,
      });
      answers.push({ studentId: st.id, rows });
      if (leaves) flagged.push({ studentId: st.id, times: Array.from({ length: leaves }, (_, k) => new Date(started.getTime() + (8 + k * 6) * MIN)) });
    }
    const saved = await scope.insert(t.attempt, attempts);
    const byStudent = new Map(saved.map((a) => [a.studentId, a.id]));
    await scope.insert(
      t.attemptAnswer,
      answers.flatMap((a) => a.rows.map((r) => ({ ...r, attemptId: byStudent.get(a.studentId)! }))),
    );
    const events = flagged.flatMap((f) =>
      f.times.map((at, k) => ({ attemptId: byStudent.get(f.studentId)!, type: "tab_hidden" as const, clientSeq: k + 1, at, meta: { awayMs: 4000 + k * 3500 } })),
    );
    if (events.length) await scope.insert(t.integrityEvent, events);
  }
  await refreshQuestionStats(scope);
}
