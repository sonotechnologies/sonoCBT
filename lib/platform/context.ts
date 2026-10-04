import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from "@/lib/auth";
import { can, type Actor } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db";
import { userRole } from "@/lib/db/schema";

/** The signed-in platform owner, or a redirect to sign in / a 404 for anyone else. */
export const requirePlatformOwner = cache(async (): Promise<{ actor: Actor; name: string; email: string }> => {
  const s = await getAuth().api.getSession({ headers: await headers() });
  if (!s) redirect("/login");
  if ((s.session as { impersonatedBy?: string | null }).impersonatedBy) notFound();
  const roles = await getDb()
    .select({ role: userRole.role, schoolId: userRole.schoolId, departmentId: userRole.departmentId, classArmId: userRole.classArmId })
    .from(userRole)
    .where(eq(userRole.userId, s.user.id));
  const actor: Actor = { id: s.user.id, roles };
  if (!can(actor, "platform.manage", { schoolId: "" })) notFound();
  return { actor, name: s.user.name, email: s.user.email };
});
