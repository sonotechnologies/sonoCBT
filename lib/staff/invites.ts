import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { createStaffAccount } from "@/lib/accounts";
import { audit } from "@/lib/audit";
import type { Db } from "@/lib/db/client";
import { classArm, school, staffInvite, subjectOffering, user } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { tenantScope, type TenantScope } from "@/lib/tenant/scope";

export const INVITE_TTL_DAYS = 14;

export type InviteRole = "school_admin" | "exam_officer" | "teacher" | "form_teacher";

export type InviteInput = {
  name: string;
  email: string;
  role: InviteRole;
  /** Subjects a teacher (or form teacher) takes. */
  subjectIds?: string[];
  /** The arm a form teacher looks after. */
  classArmId?: string | null;
};

export class InviteError extends Error {}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function inviteUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/invite/${token}`;
}

function grantsFor(input: InviteInput) {
  switch (input.role) {
    case "school_admin":
      return [{ role: "school_admin" as const }];
    case "exam_officer":
      return [{ role: "exam_officer" as const }];
    case "teacher":
      return [{ role: "teacher" as const }];
    case "form_teacher":
      // Form teachers also teach.
      return [{ role: "teacher" as const }, { role: "form_teacher" as const, classArmId: input.classArmId ?? undefined }];
  }
}

async function deliver(db: Db, schoolId: string, invite: { id: string; name: string; email: string }, token: string) {
  const [s] = await db.select({ name: school.name, isDemo: school.isDemo }).from(school).where(eq(school.id, schoolId));
  // The public demo school never sends email.
  if (s?.isDemo) return false;
  try {
    await sendEmail({
      to: invite.email,
      subject: `You're invited to ${s.name} on SonoCBT`,
      text: `Hello ${invite.name},\n\n${s.name} has added you to SonoCBT, the school's exam and results system.\n\nSet your password here (the link works for ${INVITE_TTL_DAYS} days):\n${inviteUrl(token)}\n\nIf you weren't expecting this, you can ignore this email.`,
    });
    await db.update(staffInvite).set({ sentAt: new Date() }).where(eq(staffInvite.id, invite.id));
    return true;
  } catch (e) {
    console.error("Invite email failed", e);
    return false;
  }
}

/**
 * Creates (or refreshes) an invite and emails it. Returns the raw token so the
 * admin can also copy the link (e.g. to WhatsApp) — it is never stored.
 */
export async function inviteStaff(scope: TenantScope, input: InviteInput, invitedBy: string) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!name) throw new InviteError("Add the person's name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InviteError("That email address doesn't look right.");
  if (input.role === "form_teacher") {
    if (!input.classArmId || !(await scope.findFirst(classArm, eq(classArm.id, input.classArmId)))) {
      throw new InviteError("Choose the class this form teacher looks after.");
    }
  }

  const [existingUser] = await scope.query((db) => db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1));
  if (existingUser) throw new InviteError("Someone with that email already has a SonoCBT account.");

  const token = randomBytes(24).toString("base64url");
  const values = {
    name,
    email,
    roles: grantsFor(input),
    subjectIds: input.subjectIds ?? [],
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
    sentAt: null,
    invitedBy,
  };
  const pending = await scope.findFirst(staffInvite, and(eq(staffInvite.email, email), isNull(staffInvite.acceptedAt)));
  const [invite] = pending
    ? await scope.update(staffInvite, values, eq(staffInvite.id, pending.id))
    : await scope.insert(staffInvite, values);

  const sent = await scope.query((db) => deliver(db, scope.schoolId, invite, token));
  await scope.query((db) =>
    audit(db, { schoolId: scope.schoolId, actorUserId: invitedBy, action: "staff.invite", entityType: "staff_invite", entityId: invite.id, meta: { email, role: input.role } }),
  );
  return { invite, token, sent };
}

/** New token and expiry for a pending invite, emailed again. */
export async function resendInvite(scope: TenantScope, inviteId: string, actorUserId: string) {
  const invite = await scope.findFirst(staffInvite, and(eq(staffInvite.id, inviteId), isNull(staffInvite.acceptedAt)));
  if (!invite) throw new InviteError("That invite has already been used or removed.");
  const token = randomBytes(24).toString("base64url");
  await scope.update(
    staffInvite,
    { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000), sentAt: null },
    eq(staffInvite.id, invite.id),
  );
  const sent = await scope.query((db) => deliver(db, scope.schoolId, invite, token));
  await scope.query((db) =>
    audit(db, { schoolId: scope.schoolId, actorUserId, action: "staff.inviteResent", entityType: "staff_invite", entityId: invite.id }),
  );
  return { token, sent };
}

export async function revokeInvite(scope: TenantScope, inviteId: string, actorUserId: string) {
  const n = await scope.delete(staffInvite, and(eq(staffInvite.id, inviteId), isNull(staffInvite.acceptedAt))!);
  if (n) {
    await scope.query((db) =>
      audit(db, { schoolId: scope.schoolId, actorUserId, action: "staff.inviteRevoked", entityType: "staff_invite", entityId: inviteId }),
    );
  }
}

/** Looks up a pending, unexpired invite by its raw token (public: the invite page). */
export async function findInvite(db: Db, token: string) {
  const [row] = await db
    .select({ invite: staffInvite, schoolName: school.name, schoolSlug: school.slug })
    .from(staffInvite)
    .innerJoin(school, eq(school.id, staffInvite.schoolId))
    .where(eq(staffInvite.tokenHash, hashToken(token)))
    .limit(1);
  if (!row || row.invite.acceptedAt || row.invite.expiresAt < new Date()) return null;
  return row;
}

/**
 * Accepts an invite: creates the staff login with its roles, gives them their
 * subjects' unassigned classes, and makes a form teacher the arm's form teacher.
 */
export async function acceptInvite(db: Db, token: string, password: string) {
  const found = await findInvite(db, token);
  if (!found) throw new InviteError("This invite link has expired or already been used. Ask your school admin for a new one.");
  if (password.length < 8) throw new InviteError("Use at least 8 characters.");
  const { invite } = found;
  const scope = tenantScope(db, invite.schoolId);

  const [taken] = await db.select({ id: user.id }).from(user).where(eq(user.email, invite.email)).limit(1);
  if (taken) throw new InviteError("Someone with that email already has a SonoCBT account.");

  const staff = await createStaffAccount(db, {
    schoolId: invite.schoolId,
    name: invite.name,
    email: invite.email,
    password,
    roles: invite.roles,
  });

  if (invite.subjectIds.length) {
    await scope.update(
      subjectOffering,
      { teacherId: staff.id },
      and(inArray(subjectOffering.subjectId, invite.subjectIds), isNull(subjectOffering.teacherId))!,
    );
  }
  const armId = invite.roles.find((r) => r.role === "form_teacher")?.classArmId;
  if (armId) await scope.update(classArm, { formTeacherId: staff.id }, eq(classArm.id, armId));

  await scope.update(staffInvite, { acceptedAt: new Date(), acceptedUserId: staff.id }, eq(staffInvite.id, invite.id));
  await audit(db, { schoolId: invite.schoolId, actorUserId: staff.id, action: "staff.inviteAccepted", entityType: "staff_invite", entityId: invite.id });
  return { user: staff, schoolSlug: found.schoolSlug };
}
