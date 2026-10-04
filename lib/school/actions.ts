"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import type { FormState } from "@/lib/auth/actions";
import { getDb } from "@/lib/db";
import { createSchoolWithAdmin, SetupError } from "./setup";

const signupSchema = z.object({
  schoolName: z.string().trim().min(3, "Enter your school's name."),
  adminName: z.string().trim().min(2, "Enter your name."),
  email: z.email("Enter a working email address."),
  password: z.string().min(8, "Use at least 8 characters for your password."),
});

/** Public school signup → 30-day trial → setup wizard. */
export async function signupSchool(_: FormState, form: FormData): Promise<FormState> {
  const values = {
    schoolName: String(form.get("schoolName") ?? ""),
    adminName: String(form.get("adminName") ?? ""),
    email: String(form.get("email") ?? "").trim(),
  };
  const parsed = signupSchema.safeParse({ ...values, password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message, values };

  let slug: string;
  try {
    const { school } = await createSchoolWithAdmin(getDb(), parsed.data);
    slug = school.slug;
  } catch (e) {
    if (e instanceof SetupError) return { error: e.message, values };
    throw e;
  }
  await getAuth().api.signInEmail({
    body: { email: parsed.data.email, password: parsed.data.password },
    headers: await headers(),
  });
  redirect(`/s/${slug}/setup/details`);
}
