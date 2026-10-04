"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/lib/auth/actions";
import { audit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import {
  completeOnboarding,
  saveBranding,
  saveClassesAndSubjects,
  saveSchoolDetails,
  saveSessionAndTerms,
  SetupError,
} from "@/lib/school/setup";
import { nextStep, type WizardStep } from "@/lib/school/wizard";
import { storeUpload, UploadError } from "@/lib/storage";
import { requireCan } from "@/lib/tenant/context";

async function guard(slug: string) {
  return requireCan(slug, "school.manage");
}

function goNext(slug: string, step: WizardStep): never {
  revalidatePath(`/s/${slug}`, "layout");
  const next = nextStep(step);
  redirect(next ? `/s/${slug}/setup/${next}` : `/s/${slug}/dashboard`);
}

const str = (form: FormData, k: string) => String(form.get(k) ?? "");

export async function saveDetailsAction(slug: string, _: FormState, form: FormData): Promise<FormState> {
  const ctx = await guard(slug);
  const d = {
    name: str(form, "name"),
    address: str(form, "address"),
    locality: str(form, "locality"),
    state: str(form, "state"),
    phone: str(form, "phone"),
    email: str(form, "email"),
    principalName: str(form, "principalName"),
  };
  if (d.name.trim().length < 3) return { error: "Enter your school's name." };
  if (d.email.trim() && !z.email().safeParse(d.email.trim()).success) return { error: "The school email doesn't look right." };
  await saveSchoolDetails(getDb(), ctx.school.id, d);
  await audit(getDb(), { schoolId: ctx.school.id, actorUserId: ctx.user.id, action: "school.details", entityType: "school", entityId: ctx.school.id });
  goNext(slug, "details");
}

export async function saveBrandingAction(slug: string, _: FormState, form: FormData): Promise<FormState> {
  const ctx = await guard(slug);
  const file = form.get("logo");
  let logoUrl: string | null | undefined;
  try {
    if (file instanceof File && file.size > 0) logoUrl = await storeUpload(ctx.school.id, "logo", file);
    if (form.get("removeLogo") === "1") logoUrl = null;
    const sigFile = form.get("signature");
    let principalSignatureUrl: string | null | undefined;
    if (sigFile instanceof File && sigFile.size > 0) principalSignatureUrl = await storeUpload(ctx.school.id, "signature", sigFile);
    if (form.get("removeSignature") === "1") principalSignatureUrl = null;
    await saveBranding(getDb(), ctx.school.id, { motto: str(form, "motto"), brandColor: str(form, "brandColor"), logoUrl, principalSignatureUrl });
  } catch (e) {
    if (e instanceof UploadError || e instanceof SetupError) return { error: e.message };
    throw e;
  }
  goNext(slug, "branding");
}

export async function saveSessionAction(slug: string, _: FormState, form: FormData): Promise<FormState> {
  const ctx = await guard(slug);
  const names = form.getAll("componentName").map(String);
  const weights = form.getAll("componentWeight").map((w) => Number(w));
  try {
    await saveSessionAndTerms(ctx.scope, {
      sessionName: str(form, "sessionName").trim(),
      terms: [1, 2, 3].map((n) => ({ number: n, startsOn: str(form, `t${n}Start`), endsOn: str(form, `t${n}End`) })),
      currentTerm: Number(form.get("currentTerm") ?? 1),
      components: names.map((name, i) => ({ name, weight: weights[i] })).filter((c) => c.name.trim() || c.weight),
    });
  } catch (e) {
    if (e instanceof SetupError) return { error: e.message };
    throw e;
  }
  await audit(getDb(), { schoolId: ctx.school.id, actorUserId: ctx.user.id, action: "school.session", entityType: "school", entityId: ctx.school.id });
  goNext(slug, "session");
}

const classesPayload = z.object({
  levels: z.array(z.object({ code: z.string(), arms: z.array(z.string().trim().min(1).max(20)) })),
  subjects: z.array(
    z.object({ name: z.string().trim().min(1).max(60), shortName: z.string().nullish(), stage: z.enum(["jss", "ss", "all"]) }),
  ),
});

export async function saveClassesAction(slug: string, _: FormState, form: FormData): Promise<FormState> {
  const ctx = await guard(slug);
  const parsed = classesPayload.safeParse(JSON.parse(str(form, "payload") || "{}"));
  if (!parsed.success) return { error: "Something in the class list isn't right. Check the arms and subjects." };
  if (!parsed.data.subjects.length) return { error: "Add at least one subject." };
  try {
    const { kept } = await saveClassesAndSubjects(ctx.scope, parsed.data);
    await audit(getDb(), { schoolId: ctx.school.id, actorUserId: ctx.user.id, action: "school.classes", entityType: "school", entityId: ctx.school.id, meta: { kept } });
    if (kept.length) {
      revalidatePath(`/s/${slug}`, "layout");
      return {
        error: `Saved. ${kept.join(", ")} ${kept.length === 1 ? "is" : "are"} still in use (students, results or exams), so ${kept.length === 1 ? "it was" : "they were"} kept.`,
      };
    }
  } catch (e) {
    if (e instanceof SetupError) return { error: e.message };
    throw e;
  }
  goNext(slug, "classes");
}

export async function finishSetupAction(slug: string): Promise<void> {
  const ctx = await guard(slug);
  await completeOnboarding(getDb(), ctx.school.id);
  revalidatePath(`/s/${slug}`, "layout");
  redirect(`/s/${slug}/dashboard`);
}
