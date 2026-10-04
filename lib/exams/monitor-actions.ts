"use server";

import { requireStaff } from "@/lib/tenant/context";
import * as m from "./monitor";

type Result = { error?: string; note?: string };

async function run(slug: string, fn: (ctx: Awaited<ReturnType<typeof requireStaff>>) => Promise<string>): Promise<Result> {
  const ctx = await requireStaff(slug);
  try {
    return { note: await fn(ctx) };
  } catch (e) {
    if (e instanceof m.MonitorError) return { error: e.message };
    throw e;
  }
}

const staffOf = (ctx: Awaited<ReturnType<typeof requireStaff>>) => ({ actor: ctx.actor, name: ctx.user.name });
const first = (name: string) => name.split(" ")[0];

export async function addTimeAction(slug: string, examId: string, studentId: string, name: string, minutes: number): Promise<Result> {
  return run(slug, async (ctx) => {
    await m.addTime(ctx.scope, staffOf(ctx), examId, studentId, Math.round(minutes));
    return `Added ${minutes} minutes for ${first(name)}. Their timer updates within a few seconds.`;
  });
}

export async function addTimeForEveryoneAction(slug: string, examId: string, minutes: number): Promise<Result> {
  return run(slug, async (ctx) => {
    const n = await m.addTimeForEveryone(ctx.scope, staffOf(ctx), examId, Math.round(minutes));
    return `Added ${minutes} minutes for everyone (${n} writing now). The exam also closes ${minutes} minutes later.`;
  });
}

export async function resetSessionAction(slug: string, examId: string, studentId: string, name: string): Promise<Result> {
  return run(slug, async (ctx) => {
    await m.resetSession(ctx.scope, staffOf(ctx), examId, studentId);
    return `${first(name)} can sign in again on any computer. Saved answers are kept.`;
  });
}

export async function forceSubmitAction(slug: string, examId: string, studentId: string, name: string, reason: string): Promise<Result> {
  return run(slug, async (ctx) => {
    await m.forceSubmit(ctx.scope, staffOf(ctx), examId, studentId, String(reason ?? "").slice(0, 200));
    return `${first(name)}'s exam was submitted.`;
  });
}

export async function restartAttemptAction(slug: string, examId: string, studentId: string, name: string, reason: string): Promise<Result> {
  return run(slug, async (ctx) => {
    await m.restartAttempt(ctx.scope, staffOf(ctx), examId, studentId, String(reason ?? ""));
    return `${first(name)}'s attempt was cleared. They can start again from the lobby.`;
  });
}

export async function acceptLateAnswersAction(slug: string, examId: string, studentId: string, name: string): Promise<Result> {
  return run(slug, async (ctx) => {
    const n = await m.acceptLateAnswers(ctx.scope, staffOf(ctx), examId, studentId);
    return `Counted ${n} late ${n === 1 ? "answer" : "answers"} for ${first(name)} and re-marked.`;
  });
}
