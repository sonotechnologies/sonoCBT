"use server";

import { eq } from "drizzle-orm";
import { isAPIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { school, user } from "@/lib/db/schema";
import { getSchoolBySlug, getTenantContext } from "@/lib/tenant/context";
import { acceptInvite, InviteError } from "@/lib/staff/invites";
import { studentUsername } from "./student-username";

export type FormState = { error?: string; values?: Record<string, string> } | undefined;

const staffSchema = z.object({
  email: z.email("Enter the email address your school invited."),
  password: z.string().min(1, "Enter your password."),
});

export async function staffSignIn(_: FormState, form: FormData): Promise<FormState> {
  const values = { email: String(form.get("email") ?? "").trim() };
  const parsed = staffSchema.safeParse({ ...values, password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message, values };

  let schoolId: string | null | undefined;
  try {
    const res = await getAuth().api.signInEmail({ body: parsed.data, headers: await headers() });
    schoolId = (res.user as { schoolId?: string | null }).schoolId;
  } catch (e) {
    if (isAPIError(e)) return { error: "That email and password don't match. Check them and try again.", values };
    throw e;
  }

  // Platform owners have no school: their console is /platform.
  if (!schoolId) redirect("/platform");
  const [s] = await getDb().select({ slug: school.slug }).from(school).where(eq(school.id, schoolId)).limit(1);
  redirect(`/s/${s.slug}/dashboard`);
}

const studentSchema = z.object({
  admissionNo: z.string().trim().min(1, "Enter your admission number."),
  password: z.string().min(1, "Enter your password."),
});

export async function studentSignIn(schoolSlug: string, _: FormState, form: FormData): Promise<FormState> {
  const values = { admissionNo: String(form.get("admissionNo") ?? "").trim() };
  const parsed = studentSchema.safeParse({ ...values, password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message, values };

  const s = await getSchoolBySlug(schoolSlug);
  if (!s) return { error: "This school link isn't right. Ask your school for the correct one.", values };

  try {
    await getAuth().api.signInUsername({
      body: { username: studentUsername(s.id, parsed.data.admissionNo), password: parsed.data.password },
      headers: await headers(),
    });
  } catch (e) {
    if (isAPIError(e)) {
      if ((e.body as { code?: string } | undefined)?.code === "BANNED_USER") return { error: e.message, values };
      return { error: "That admission number and password don't match. Check your ID card and try again.", values };
    }
    throw e;
  }
  redirect(`/s/${schoolSlug}/student`);
}

export async function signOut(redirectTo: string): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect(redirectTo.startsWith("/") ? redirectTo : "/");
}

const changeSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: z.string().min(8, "Use at least 8 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { message: "The two new passwords don't match.", path: ["confirm"] })
  .refine((v) => v.newPassword !== v.currentPassword, { message: "Choose a password you haven't used here." });

export async function changePassword(schoolSlug: string, _: FormState, form: FormData): Promise<FormState> {
  const ctx = await getTenantContext(schoolSlug);
  if (!ctx) redirect(`/s/${schoolSlug}/login`);
  if (ctx.school.isDemo) return { error: "Demo accounts can't change their password. Everything in the demo school resets each night." };

  const parsed = changeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await getAuth().api.changePassword({
      body: { currentPassword: parsed.data.currentPassword, newPassword: parsed.data.newPassword },
      headers: await headers(),
    });
  } catch (e) {
    if (isAPIError(e)) return { error: "Your current password isn't right." };
    throw e;
  }
  await getDb().update(user).set({ mustChangePassword: false }).where(eq(user.id, ctx.user.id));
  // The session cookie caches the user for a minute; refresh it, or they'd be sent straight back here.
  await getAuth().api.getSession({ headers: await headers(), query: { disableCookieCache: true } });
  redirect(ctx.student ? `/s/${schoolSlug}/student` : `/s/${schoolSlug}/dashboard`);
}

const forgotSchema = z.object({ email: z.email("Enter the email you sign in with.") });

/** Always answers the same way, so it can't be used to discover who has an account. */
export async function requestPasswordResetAction(_: FormState, form: FormData): Promise<FormState & { sent?: boolean }> {
  const values = { email: String(form.get("email") ?? "").trim() };
  const parsed = forgotSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message, values };
  try {
    await getAuth().api.requestPasswordReset({ body: { email: parsed.data.email, redirectTo: "/reset-password" }, headers: await headers() });
  } catch (e) {
    if (!isAPIError(e)) throw e;
  }
  return { sent: true, values };
}

const resetSchema = z
  .object({ token: z.string().min(1), password: z.string().min(8, "Use at least 8 characters."), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "The two passwords don't match." });

export async function resetPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = resetSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await getAuth().api.resetPassword({ body: { newPassword: parsed.data.password, token: parsed.data.token } });
  } catch (e) {
    if (isAPIError(e)) return { error: "This reset link has expired or already been used. Ask for a new one." };
    throw e;
  }
  redirect("/login?reset=1");
}

const acceptSchema = z
  .object({ token: z.string().min(1), password: z.string().min(8, "Use at least 8 characters."), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "The two passwords don't match." });

export async function acceptInviteAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = acceptSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  let slug: string;
  let email: string;
  try {
    const res = await acceptInvite(getDb(), parsed.data.token, parsed.data.password);
    slug = res.schoolSlug;
    email = res.user.email;
  } catch (e) {
    if (e instanceof InviteError) return { error: e.message };
    throw e;
  }
  await getAuth().api.signInEmail({ body: { email, password: parsed.data.password }, headers: await headers() });
  redirect(`/s/${slug}/dashboard`);
}
