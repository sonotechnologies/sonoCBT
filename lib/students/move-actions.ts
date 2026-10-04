"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/tenant/context";
import { endStudent, MoveError, moveStudent, promoteStudents, readmitStudent, type Target } from "./moves";

type Result<T = object> = { error?: string } & Partial<T>;

async function run<T>(slug: string, fn: (ctx: Awaited<ReturnType<typeof requireStaff>>) => Promise<T>): Promise<Result<{ data: T }>> {
  const ctx = await requireStaff(slug);
  try {
    const data = await fn(ctx);
    revalidatePath(`/s/${slug}/students`);
    return { data };
  } catch (e) {
    if (e instanceof MoveError) return { error: e.message };
    throw e;
  }
}

const target = z.discriminatedUnion("kind", [z.object({ kind: z.literal("arm"), armId: z.uuid() }), z.object({ kind: z.literal("stay") }), z.object({ kind: z.literal("graduate") }), z.object({ kind: z.literal("left") })]);
const promotion = z.object({ classes: z.record(z.uuid(), target), students: z.record(z.uuid(), target).optional(), again: z.boolean().optional() });

export async function promoteAction(slug: string, input: unknown) {
  const p = promotion.safeParse(input);
  if (!p.success) return { error: "Some choices weren't in the expected shape. Reload the page." };
  return run(slug, (ctx) => promoteStudents(ctx.scope, ctx.actor, p.data as { classes: Record<string, Target>; students?: Record<string, Target>; again?: boolean }));
}

export async function moveStudentAction(slug: string, studentId: string, armId: string) {
  return run(slug, (ctx) => moveStudent(ctx.scope, ctx.actor, studentId, armId));
}

export async function endStudentAction(slug: string, studentId: string, kind: "graduated" | "left", reason: string) {
  if (kind !== "graduated" && kind !== "left") return { error: "Choose graduated or left." };
  return run(slug, (ctx) => endStudent(ctx.scope, ctx.actor, studentId, kind, reason));
}

export async function readmitStudentAction(slug: string, studentId: string, armId: string) {
  return run(slug, (ctx) => readmitStudent(ctx.scope, ctx.actor, studentId, armId));
}
