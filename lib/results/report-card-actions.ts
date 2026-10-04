"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/tenant/context";
import { fillPrincipalRemarks, saveExtras, setDaysOpened } from "./extras";
import { generatePinBatch } from "./pins";
import { ResultsError } from "./pipeline";

type Result<T = object> = { error?: string } & Partial<T>;

async function run<T>(slug: string, fn: (ctx: Awaited<ReturnType<typeof requireStaff>>) => Promise<T>, paths: string[] = []): Promise<Result<{ data: T }>> {
  const ctx = await requireStaff(slug);
  try {
    const data = await fn(ctx);
    for (const p of paths) revalidatePath(`/s/${slug}${p}`);
    return { data };
  } catch (e) {
    if (e instanceof ResultsError) return { error: e.message };
    throw e;
  }
}

const rating = z.record(z.string().max(30), z.number().int());
const extras = z.object({
  formTeacherRemark: z.string().max(400).nullable().optional(),
  principalRemark: z.string().max(400).nullable().optional(),
  affective: rating.optional(),
  psychomotor: rating.optional(),
  daysPresent: z.number().int().nullable().optional(),
  daysOpened: z.number().int().nullable().optional(),
});

export async function saveExtrasAction(slug: string, termId: string, classArmId: string, studentId: string, input: unknown) {
  const p = extras.safeParse(input);
  if (!p.success) return { error: "Some of the details weren't in the expected shape. Reload the page." };
  return run(slug, (ctx) => saveExtras(ctx.scope, ctx.actor, termId, classArmId, studentId, p.data), [`/report-cards/${classArmId}`]);
}

export async function setDaysOpenedAction(slug: string, termId: string, classArmId: string, days: number) {
  if (!Number.isInteger(days)) return { error: "Enter a whole number of days." };
  return run(slug, (ctx) => setDaysOpened(ctx.scope, ctx.actor, termId, classArmId, days), [`/report-cards/${classArmId}`]);
}

export async function fillPrincipalRemarksAction(slug: string, termId: string, classArmId: string) {
  return run(slug, (ctx) => fillPrincipalRemarks(ctx.scope, ctx.actor, termId, classArmId), [`/report-cards/${classArmId}`]);
}

export async function generatePinsAction(slug: string, termId: string, count: number, maxUses: number) {
  return run(slug, (ctx) => generatePinBatch(ctx.scope, ctx.actor, { termId, count, maxUses }), ["/results/pins"]);
}
