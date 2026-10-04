"use server";

import { headers } from "next/headers";
import { requireStudent } from "@/lib/tenant/context";
import { clientIp } from "./integrity";
import { RuntimeError, startAttempt } from "./runtime";

/**
 * Lobby → exam. Starts (or resumes) the attempt, then the browser loads the
 * exam page in full, so the offline copy can be kept.
 */
export async function startExamAction(slug: string, examId: string, pin: string, deviceSessionId: string): Promise<{ href: string } | { error: string }> {
  const { scope, student } = await requireStudent(slug);
  try {
    await startAttempt(scope, student.id, examId, { pin: pin.slice(0, 20), deviceSessionId: deviceSessionId.slice(0, 64), ip: clientIp(await headers()) });
    return { href: `/s/${slug}/exam/${examId}/take` };
  } catch (e) {
    if (e instanceof RuntimeError) return { error: e.message };
    throw e;
  }
}
