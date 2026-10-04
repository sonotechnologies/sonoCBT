"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { requirePlatformOwner } from "./context";
import { PlatformError, setSuspended, supportTarget } from "./service";

type State = { error?: string } | undefined;

export async function suspendAction(schoolId: string, suspend: boolean, _: State, form: FormData): Promise<State> {
  const { actor } = await requirePlatformOwner();
  try {
    await setSuspended(getDb(), actor, schoolId, suspend, String(form.get("reason") ?? ""));
  } catch (e) {
    if (e instanceof PlatformError) return { error: e.message };
    throw e;
  }
  revalidatePath("/platform");
  revalidatePath(`/platform/schools/${schoolId}`);
  return {};
}

/**
 * Support sign-in: the platform owner becomes the school's admin for up to an
 * hour (a separate session; theirs is kept and restored on "End support").
 * Logged in the school's audit trail.
 */
export async function startSupportAction(schoolId: string) {
  const { actor } = await requirePlatformOwner();
  const db = getDb();
  const target = await supportTarget(db, actor, schoolId);
  await audit(db, { schoolId, actorUserId: actor.id, action: "platform.impersonate", entityType: "user", entityId: target.userId, meta: { as: target.name } });
  await getAuth().api.impersonateUser({ body: { userId: target.userId }, headers: await headers() });
  redirect(`/s/${target.slug}/dashboard`);
}

/** Ends a support session and returns to the console. */
export async function endSupportAction(schoolId: string) {
  const s = await getAuth().api.getSession({ headers: await headers() });
  const by = (s?.session as { impersonatedBy?: string | null } | undefined)?.impersonatedBy;
  if (by) {
    await audit(getDb(), { schoolId, actorUserId: by, action: "platform.impersonate_end", entityType: "user", entityId: s!.user.id });
    await getAuth().api.stopImpersonating({ headers: await headers() });
  }
  redirect(by ? `/platform/schools/${schoolId}` : "/login");
}
