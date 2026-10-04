import { eq } from "drizzle-orm";
import { can, type Actor } from "@/lib/auth/permissions";
import { subject, subjectOffering } from "@/lib/db/schema";
import type { TenantScope } from "@/lib/tenant/scope";

export class AnalyticsError extends Error {}

/**
 * Which subjects someone may see analytics for: everything for the admin and
 * exam officer; their department's subjects for an HOD; the subjects they
 * teach for a teacher. `subjectIds` null means all.
 */
export type AnalyticsAccess = { schoolWide: boolean; subjectIds: Set<string> | null };

export async function analyticsAccess(scope: TenantScope, actor: Actor): Promise<AnalyticsAccess | null> {
  if (can(actor, "analytics.view", { schoolId: scope.schoolId })) return { schoolWide: true, subjectIds: null };
  const [subjects, taught] = await Promise.all([scope.findMany(subject), scope.findMany(subjectOffering, eq(subjectOffering.teacherId, actor.id))]);
  const ids = new Set<string>();
  for (const s of subjects) if (s.departmentId && can(actor, "analytics.view", { schoolId: scope.schoolId, departmentId: s.departmentId })) ids.add(s.id);
  for (const o of taught) if (can(actor, "analytics.view", { schoolId: scope.schoolId, teacherId: o.teacherId })) ids.add(o.subjectId);
  return ids.size ? { schoolWide: false, subjectIds: ids } : null;
}

export const sees = (a: AnalyticsAccess, subjectId: string | null | undefined) => a.subjectIds === null || (!!subjectId && a.subjectIds.has(subjectId));

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const PASS_MARK = 40;
