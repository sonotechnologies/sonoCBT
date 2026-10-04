"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getSchoolBySlug } from "@/lib/tenant/context";
import { checkResult } from "./checker";
import { createResultToken, RESULT_COOKIE, RESULT_TTL_SECONDS } from "./token";

export type CheckState = { error?: string; values?: { admissionNo?: string; pin?: string; termId?: string } } | undefined;

const schema = z.object({
  school: z.string().min(1),
  admissionNo: z.string().trim().min(1, "Enter the admission number."),
  pin: z.string().trim().min(1, "Enter the PIN from the card."),
  termId: z.uuid("Choose a term."),
});

export async function checkResultAction(_: CheckState, form: FormData): Promise<CheckState> {
  const raw = Object.fromEntries(form) as Record<string, string>;
  const values = { admissionNo: raw.admissionNo, pin: raw.pin, termId: raw.termId };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message, values };

  const school = await getSchoolBySlug(parsed.data.school);
  if (!school) return { error: "Choose your child's school.", values };

  const outcome = await checkResult(getDb(), {
    schoolId: school.id,
    admissionNo: parsed.data.admissionNo,
    pin: parsed.data.pin,
    termId: parsed.data.termId,
  });
  if (!outcome.ok) return { error: outcome.message, values };

  (await cookies()).set(
    RESULT_COOKIE,
    createResultToken({ schoolId: school.id, studentId: outcome.studentId, termId: outcome.termId }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/results",
      maxAge: RESULT_TTL_SECONDS,
    },
  );
  redirect("/results/view");
}
