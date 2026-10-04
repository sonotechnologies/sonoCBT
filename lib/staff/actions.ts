"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCan } from "@/lib/tenant/context";
import { setOfferingTeacher } from "./allocation";
import { InviteError, inviteStaff, inviteUrl, resendInvite, revokeInvite } from "./invites";

export type InviteState =
  | { ok?: undefined; error?: string; values?: Record<string, string> }
  | { ok: true; name: string; email: string; link: string; sent: boolean }
  | undefined;

const schema = z.object({
  name: z.string().trim().min(2, "Add the person's name."),
  email: z.email("That email address doesn't look right."),
  role: z.enum(["school_admin", "exam_officer", "teacher", "form_teacher"]),
  classArmId: z.string().optional(),
  subjectIds: z.array(z.uuid()).default([]),
});

export async function inviteAction(slug: string, _: InviteState, form: FormData): Promise<InviteState> {
  const ctx = await requireCan(slug, "staff.manage");
  const raw = {
    name: String(form.get("name") ?? ""),
    email: String(form.get("email") ?? "").trim(),
    role: String(form.get("role") ?? ""),
    classArmId: String(form.get("classArmId") ?? "") || undefined,
    subjectIds: form.getAll("subjectIds").map(String),
  };
  const values = { name: raw.name, email: raw.email, role: raw.role, classArmId: raw.classArmId ?? "" };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message, values };
  try {
    const { token, sent, invite } = await inviteStaff(ctx.scope, parsed.data, ctx.user.id);
    revalidatePath(`/s/${slug}`, "layout");
    return { ok: true, name: invite.name, email: invite.email, link: inviteUrl(token), sent };
  } catch (e) {
    if (e instanceof InviteError) return { error: e.message, values };
    throw e;
  }
}

export async function resendInviteAction(slug: string, inviteId: string): Promise<{ link?: string; sent?: boolean; error?: string }> {
  const ctx = await requireCan(slug, "staff.manage");
  try {
    const { token, sent } = await resendInvite(ctx.scope, inviteId, ctx.user.id);
    revalidatePath(`/s/${slug}`, "layout");
    return { link: inviteUrl(token), sent };
  } catch (e) {
    if (e instanceof InviteError) return { error: e.message };
    throw e;
  }
}

export async function revokeInviteAction(slug: string, inviteId: string): Promise<void> {
  const ctx = await requireCan(slug, "staff.manage");
  await revokeInvite(ctx.scope, inviteId, ctx.user.id);
  revalidatePath(`/s/${slug}`, "layout");
}

export async function setOfferingTeacherAction(slug: string, offeringId: string, teacherId: string | null): Promise<{ error?: string }> {
  const ctx = await requireCan(slug, "staff.manage");
  try {
    await setOfferingTeacher(ctx.scope, offeringId, teacherId, ctx.user.id);
    return {};
  } catch {
    return { error: "Couldn't save that. Refresh and try again." };
  }
}
