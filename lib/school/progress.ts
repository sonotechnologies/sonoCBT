import "server-only";
import { count } from "drizzle-orm";
import { classArm, staffInvite, student, term } from "@/lib/db/schema";
import type { School } from "@/lib/tenant/context";
import type { TenantScope, TenantTable } from "@/lib/tenant/scope";
import type { WizardStep } from "./wizard";

/** Which setup steps have something saved, derived from the school's data. */
export async function setupProgress(scope: TenantScope, school: School): Promise<Record<WizardStep, boolean>> {
  const has = (table: TenantTable) =>
    scope.query(async (db, owns) => ((await db.select({ n: count() }).from(table).where(owns(table)))[0]?.n ?? 0) > 0);
  const [terms, arms, invites, students] = await Promise.all([has(term), has(classArm), has(staffInvite), has(student)]);
  return {
    details: !!(school.address || school.state || school.phone),
    branding: !!school.brandColor,
    session: terms,
    classes: arms,
    staff: invites,
    students,
  };
}
