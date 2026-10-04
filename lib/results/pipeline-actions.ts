"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/tenant/context";
import { moveBatches, ResultsError, saveComponents, saveScale, saveScores, type BatchAction, type CellChange } from "./pipeline";

type Result = { error?: string };

async function run(slug: string, fn: (ctx: Awaited<ReturnType<typeof requireStaff>>) => Promise<unknown>, paths: string[] = []): Promise<Result> {
  const ctx = await requireStaff(slug);
  try {
    await fn(ctx);
    for (const p of paths) revalidatePath(`/s/${slug}${p}`);
    return {};
  } catch (e) {
    if (e instanceof ResultsError) return { error: e.message };
    throw e;
  }
}

const components = z.array(z.object({ id: z.string().optional(), name: z.string().max(40), weight: z.coerce.number() })).max(12);

export async function saveComponentsAction(slug: string, termId: string, input: unknown): Promise<Result> {
  const p = components.safeParse(input);
  if (!p.success) return { error: "Check the components." };
  return run(slug, (ctx) => saveComponents(ctx.scope, ctx.actor, termId, p.data), ["/results/setup", "/results"]);
}

const bands = z.array(z.object({ min: z.coerce.number(), max: z.coerce.number(), grade: z.string().max(4), remark: z.string().max(40) })).max(20);

export async function saveScaleAction(slug: string, input: unknown): Promise<Result> {
  const p = bands.safeParse(input);
  if (!p.success) return { error: "Check the grades." };
  return run(slug, (ctx) => saveScale(ctx.scope, ctx.actor, p.data), ["/results/setup"]);
}

const cells = z.array(z.object({ studentId: z.uuid(), componentId: z.uuid(), value: z.number().nullable() })).max(2000);

export async function saveScoresAction(slug: string, termId: string, classArmId: string, subjectId: string, changes: CellChange[], reason?: string): Promise<Result & { saved?: number }> {
  const p = cells.safeParse(changes);
  if (!p.success) return { error: "Some scores weren't in the expected shape. Reload the page." };
  const ctx = await requireStaff(slug);
  try {
    const r = await saveScores(ctx.scope, ctx.actor, { termId, classArmId, subjectId, changes: p.data, reason });
    return { saved: r.saved };
  } catch (e) {
    if (e instanceof ResultsError) return { error: e.message };
    throw e;
  }
}

export async function moveBatchesAction(slug: string, termId: string, classArmIds: string[], action: BatchAction, reason?: string): Promise<Result> {
  return run(slug, (ctx) => moveBatches(ctx.scope, ctx.actor, termId, classArmIds.slice(0, 200), action, reason), ["/results", "/results/classes"]);
}
