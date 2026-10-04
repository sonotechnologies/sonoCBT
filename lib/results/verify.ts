import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { reportCardCode, school } from "@/lib/db/schema";
import { tenantScope } from "@/lib/tenant/scope";
import { buildReportCards, classArmForTerm, getTermLabel, type ReportCard } from "./report-card";

/** Codes are printed as GFA-7Q2M-K9XD; accept them typed loosely (lower case, spaces, O for 0, I/L for 1). */
export function normaliseCode(raw: string): string | null {
  const s = raw
    .toUpperCase()
    .replace(/[\s_]+/g, "")
    .replace(/[^A-Z0-9-]/g, "");
  const m = /^([A-Z]{2,4})-?([0-9A-Z]{4})-?([0-9A-Z]{4})$/.exec(s);
  if (!m) return null;
  const fix = (x: string) => x.replace(/O/g, "0").replace(/[IL]/g, "1");
  return `${m[1]}-${fix(m[2])}-${fix(m[3])}`;
}

export type VerifyResult =
  | { status: "unknown" }
  | { status: "withdrawn"; schoolName: string; termLabel: string }
  | { status: "valid"; card: ReportCard };

/**
 * The public verify page: shows what the school's records say today for the
 * card with this code, so an altered printout won't match.
 */
export async function verifyReportCard(db: Db, raw: string): Promise<VerifyResult> {
  const code = normaliseCode(raw);
  if (!code) return { status: "unknown" };
  const [row] = await db.select().from(reportCardCode).where(eq(reportCardCode.code, code));
  if (!row) return { status: "unknown" };
  const [sch] = await db.select({ name: school.name, status: school.status }).from(school).where(eq(school.id, row.schoolId));
  if (!sch || sch.status === "suspended") return { status: "unknown" };
  const scope = tenantScope(db, row.schoolId);
  const armId = await classArmForTerm(scope, row.studentId, row.termId);
  const built = armId ? await buildReportCards(scope, row.termId, armId, { studentIds: [row.studentId] }) : null;
  const card = built?.cards[0];
  if (!built?.released || !card) return { status: "withdrawn", schoolName: sch.name, termLabel: built?.termLabel || (await getTermLabel(scope, row.termId)).label };
  return { status: "valid", card };
}
