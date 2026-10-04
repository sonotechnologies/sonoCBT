/**
 * AI help with theory marking: a suggested score and the marking points it
 * found. Only the question, the marking guide and the answer text are sent —
 * never the student's name, admission number or any other score. The teacher
 * always decides; nothing is applied automatically.
 */
import { z } from "zod";
import type { AiProvider } from "./provider";

const schema = {
  type: "OBJECT",
  properties: {
    marks: { type: "NUMBER", description: "Suggested score, between 0 and the maximum." },
    points: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { ok: { type: "BOOLEAN" }, text: { type: "STRING", description: "One marking point, a few words." } },
        required: ["ok", "text"],
      },
    },
  },
  required: ["marks", "points"],
};

const zReply = z.object({
  marks: z.number(),
  points: z.array(z.object({ ok: z.boolean(), text: z.string().min(1).max(160) })).max(12),
});

export type MarkSuggestion = { marks: number; points: { ok: boolean; text: string }[] };

export async function suggestTheoryMark(
  ai: AiProvider,
  r: { question: string; guide: string; maxMarks: number; answer: string },
): Promise<MarkSuggestion> {
  const reply = await ai.generate({
    system: `You help Nigerian secondary school teachers mark written answers fairly against the marking guide (WAEC/NECO style).
Award marks only for points the guide credits, or clearly equivalent correct points. Ignore spelling and grammar unless the guide says otherwise.
Be strict about wrong science or maths. Keep each point short. Never invent marking points the answer doesn't contain.`,
    parts: [
      {
        text: `Question (${r.maxMarks} marks):\n${r.question}\n\nMarking guide:\n${r.guide || "(none given: use your knowledge of the subject at this level)"}\n\nStudent's answer:\n${r.answer.slice(0, 6000)}\n\nList the marking points you checked (ok = earned) and suggest a score out of ${r.maxMarks}. Use whole or half marks.`,
      },
    ],
    schema,
    parse: zReply,
    temperature: 0,
  });
  const marks = Math.max(0, Math.min(r.maxMarks, Math.round(reply.marks * 2) / 2));
  return { marks, points: reply.points };
}
