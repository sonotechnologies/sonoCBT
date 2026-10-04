/**
 * AI tasks for the question bank: read a photographed paper, write new
 * questions, suggest topic/difficulty tags. Each returns SimpleQuestions that
 * become review items; nothing reaches the bank without a teacher accepting it.
 */
import { z } from "zod";
import type { SimpleQuestion } from "@/lib/import/simple";
import type { AiPart, AiProvider } from "./provider";

const QUESTION_TYPES = ["objective", "multiple answer", "true/false", "fill in the gap", "numeric", "theory"] as const;

const questionSchema = {
  type: "OBJECT",
  properties: {
    number: { type: "INTEGER", nullable: true },
    type: { type: "STRING", enum: [...QUESTION_TYPES] },
    stem: { type: "STRING", description: "Question text. Maths and chemistry as LaTeX between single $ signs, e.g. $\\frac{1}{2}$, $\\ce{H2O}$." },
    options: { type: "ARRAY", items: { type: "STRING" }, description: "Option texts without the letters, in order. Empty for non-objective questions." },
    answer: {
      type: "STRING",
      description: "Objective: the letter(s), e.g. B or A,C. True/false: True or False. Gap/numeric: the answer. Theory: marking points. Empty if not shown.",
    },
    marks: { type: "NUMBER", nullable: true },
    topic: { type: "STRING", nullable: true },
    difficulty: { type: "STRING", enum: ["easy", "medium", "hard"], nullable: true },
    explanation: { type: "STRING", nullable: true },
  },
  required: ["type", "stem", "options", "answer"],
};

const replySchema = { type: "OBJECT", properties: { questions: { type: "ARRAY", items: questionSchema } }, required: ["questions"] };

const zQuestion = z.object({
  number: z.number().int().nullish(),
  type: z.string(),
  stem: z.string().min(1),
  options: z.array(z.string()).default([]),
  answer: z.string().default(""),
  marks: z.number().nullish(),
  topic: z.string().nullish(),
  difficulty: z.string().nullish(),
  explanation: z.string().nullish(),
});
const zReply = z.object({ questions: z.array(zQuestion).max(120) });

const RULES = `Write for Nigerian secondary schools (JSS1–SS3, WAEC/NECO/BECE style). Use British English and Nigerian contexts (naira, local names and places).
Maths and chemistry: LaTeX between single dollar signs ($x^2$, $\\frac{3}{4}$, $\\ce{CaCO3}$). Never use images.`;

/** Reads 1–10 photos of a printed or handwritten question paper. */
export async function readQuestionPhotos(ai: AiProvider, photos: { mimeType: string; base64: string }[], ctx: { subject: string; classLevel: string | null }): Promise<SimpleQuestion[]> {
  const parts: AiPart[] = [
    {
      text: `These are photos of a ${ctx.classLevel ?? "secondary school"} ${ctx.subject} question paper, in page order. Transcribe every question exactly as written (do not solve, rephrase or add questions).
For each: number, type, stem, options (without letters), and the answer only if the paper marks it (a tick, circle, asterisk or answer key) — otherwise leave answer empty.
Skip the school header, instructions and candidate details. If a question has a diagram, keep the words and add "[diagram]" to the stem.`,
    },
    ...photos.map((p) => ({ image: p })),
  ];
  const reply = await ai.generate({ system: RULES, parts, schema: replySchema, parse: zReply, temperature: 0 });
  return reply.questions;
}

export type GenerateRequest = {
  subject: string;
  classLevel: string;
  topic: string;
  count: number;
  types: ("objective" | "true/false" | "fill in the gap" | "theory")[];
  difficulty: "easy" | "medium" | "hard" | "mixed";
  lessonNote?: string;
};

/** Writes draft questions on a topic (optionally from a lesson note), with answers and explanations. */
export async function generateQuestions(ai: AiProvider, r: GenerateRequest): Promise<SimpleQuestion[]> {
  const note = r.lessonNote?.trim() ? `\n\nBase the questions on this lesson note:\n"""\n${r.lessonNote.trim().slice(0, 12_000)}\n"""` : "";
  const reply = await ai.generate({
    system: RULES,
    parts: [
      {
        text: `Write ${r.count} exam questions for ${r.classLevel} ${r.subject} on the topic "${r.topic}".
Question types to use: ${r.types.join(", ")}. Difficulty: ${r.difficulty === "mixed" ? "a mix of easy, medium and hard" : r.difficulty}.
Objective questions have exactly 4 options (A–D), one clearly correct answer and plausible wrong options. Give the answer letter.
Theory questions: give marks (2–10) and marking points as the answer.
Every question: topic "${r.topic}", a difficulty, and a one-sentence explanation of the answer.
Check every answer carefully; do not repeat questions.${note}`,
      },
    ],
    schema: replySchema,
    parse: zReply,
    temperature: 0.7,
  });
  return reply.questions.slice(0, r.count);
}

const tagSchema = {
  type: "OBJECT",
  properties: {
    tags: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { id: { type: "STRING" }, topic: { type: "STRING" }, difficulty: { type: "STRING", enum: ["easy", "medium", "hard"] } },
        required: ["id", "topic", "difficulty"],
      },
    },
  },
  required: ["tags"],
};
const zTags = z.object({ tags: z.array(z.object({ id: z.string(), topic: z.string(), difficulty: z.enum(["easy", "medium", "hard"]) })) });

/** Suggests a topic and difficulty for each question (question text only is sent). */
export async function suggestTags(
  ai: AiProvider,
  ctx: { subject: string; classLevel: string | null; knownTopics: string[] },
  questions: { id: string; text: string }[],
) {
  const reply = await ai.generate({
    system: RULES,
    parts: [
      {
        text: `For each ${ctx.classLevel ?? ""} ${ctx.subject} question below, give a short syllabus topic (2–4 words) and a difficulty for that class.
${ctx.knownTopics.length ? `Prefer these existing topics when they fit: ${ctx.knownTopics.slice(0, 60).join("; ")}.` : ""}
Return one entry per id.

${questions.map((q) => `[${q.id}] ${q.text.slice(0, 600)}`).join("\n")}`,
      },
    ],
    schema: tagSchema,
    parse: zTags,
    temperature: 0,
  });
  return reply.tags;
}
