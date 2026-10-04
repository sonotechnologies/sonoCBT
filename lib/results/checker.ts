import { and, eq, gt, sql } from "drizzle-orm";
import { normaliseAdmissionNo } from "@/lib/auth/student-username";
import type { Db } from "@/lib/db/client";
import { resultPin, student } from "@/lib/db/schema";
import { tenantScope } from "@/lib/tenant/scope";
import { hashPin, isWellFormedPin } from "./pin";
import { classArmForTerm, getTermLabel, isReleased } from "./report-card";

export type CheckInput = { schoolId: string; admissionNo: string; pin: string; termId: string };

export type CheckOutcome =
  | { ok: true; studentId: string; termId: string; usesLeft: number }
  | {
      ok: false;
      reason: "not_found" | "wrong_term" | "other_student" | "used_up" | "not_released";
      message: string;
    };

const NOT_FOUND =
  "We couldn't find a result for that admission number and PIN. Check both against the card and try again.";

/**
 * Parent result check with a scratch-card PIN. A view uses one of the PIN's
 * uses; checks that fail (including "not yet released") use nothing.
 * The first successful use binds the PIN to that student.
 */
export async function checkResult(db: Db, input: CheckInput): Promise<CheckOutcome> {
  const scope = tenantScope(db, input.schoolId);
  if (!isWellFormedPin(input.pin)) return { ok: false, reason: "not_found", message: NOT_FOUND };

  const [pin, stu] = await Promise.all([
    scope.findFirst(resultPin, eq(resultPin.pinHash, hashPin(input.schoolId, input.pin))),
    scope.findFirst(student, sql`upper(replace(${student.admissionNo}, ' ', '')) = ${normaliseAdmissionNo(input.admissionNo)}`),
  ]);
  if (!pin || !stu) return { ok: false, reason: "not_found", message: NOT_FOUND };

  if (pin.termId !== input.termId) {
    const { label } = await getTermLabel(scope, pin.termId);
    return { ok: false, reason: "wrong_term", message: `This PIN is for ${label}. Choose that term and try again.` };
  }
  if (pin.studentId && pin.studentId !== stu.id) {
    return {
      ok: false,
      reason: "other_student",
      message: "This PIN has already been used for another student. Each card works for one student only.",
    };
  }
  if (pin.usesLeft <= 0) {
    return {
      ok: false,
      reason: "used_up",
      message: "This PIN has been used the maximum number of times. Get a new card from the school.",
    };
  }

  const armId = await classArmForTerm(scope, stu.id, input.termId);
  if (!armId || !(await isReleased(scope, input.termId, armId))) {
    const { label } = await getTermLabel(scope, input.termId);
    return {
      ok: false,
      reason: "not_released",
      message: `Results for ${label} have not been released yet. Your PIN has not been used — try again once the school announces results.`,
    };
  }

  // Atomic: only succeeds while uses remain and the PIN is unbound or bound to this student.
  const [used] = await scope.update(
    resultPin,
    { usesLeft: sql`${resultPin.usesLeft} - 1`, studentId: stu.id, lastUsedAt: new Date() } as never,
    and(
      eq(resultPin.id, pin.id),
      gt(resultPin.usesLeft, 0),
      sql`(${resultPin.studentId} is null or ${resultPin.studentId} = ${stu.id})`,
    )!,
  );
  if (!used) {
    return {
      ok: false,
      reason: "used_up",
      message: "This PIN has been used the maximum number of times. Get a new card from the school.",
    };
  }
  return { ok: true, studentId: stu.id, termId: input.termId, usesLeft: used.usesLeft };
}
