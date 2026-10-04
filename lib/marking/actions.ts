"use server";

import { revalidatePath } from "next/cache";
import { AiError, runAi } from "@/lib/ai";
import { suggestTheoryMark } from "@/lib/ai/marking";
import { ResultsError } from "@/lib/results/pipeline";
import { requireStaff } from "@/lib/tenant/context";
import { MarkingError, pushExamScores, saveMark, suggestMark } from "./service";

export async function saveMarkAction(slug: string, answerId: string, marks: number, comment: string | null): Promise<{ error?: string }> {
  const ctx = await requireStaff(slug);
  try {
    await saveMark(ctx.scope, ctx.actor, answerId, Number(marks), comment);
    return {};
  } catch (e) {
    if (e instanceof MarkingError) return { error: e.message };
    throw e;
  }
}

export async function suggestMarkAction(slug: string, answerId: string): Promise<{ marks?: number; points?: { ok: boolean; text: string }[]; error?: string }> {
  const ctx = await requireStaff(slug);
  try {
    return await runAi(ctx.scope, ctx.user.id, "mark", (ai) => suggestMark(ctx.scope, ctx.actor, answerId, (r) => suggestTheoryMark(ai, r)));
  } catch (e) {
    if (e instanceof MarkingError || e instanceof AiError) return { error: e.message };
    throw e;
  }
}

export async function pushScoresAction(slug: string, examId: string): Promise<{ error?: string; note?: string }> {
  const ctx = await requireStaff(slug);
  try {
    const r = await pushExamScores(ctx.scope, ctx.actor, examId);
    revalidatePath(`/s/${slug}/marking`);
    const extra = r.skipped.length ? ` Some classes were skipped: ${[...new Set(r.skipped)].join(" ")}` : "";
    return { note: `Sent ${r.students} students' scores to the CA grid as ${r.component} (${r.saved} cells changed).${extra}` };
  } catch (e) {
    if (e instanceof MarkingError || e instanceof ResultsError) return { error: e.message };
    throw e;
  }
}
