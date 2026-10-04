import "server-only";
import { desc, eq } from "drizzle-orm";
import { academicSession, term } from "@/lib/db/schema";
import { termLabel } from "@/lib/format";
import type { TenantScope } from "@/lib/tenant/scope";

export type TermWithSession = {
  id: string;
  number: number;
  sessionName: string;
  nextResumesOn: string | null;
  isCurrent: boolean;
  label: string;
};

/** All terms of the school, newest first. */
export function listTerms(scope: TenantScope): Promise<TermWithSession[]> {
  return scope.query(async (db, owns) => {
    const rows = await db
      .select({
        id: term.id,
        number: term.number,
        sessionName: academicSession.name,
        nextResumesOn: term.nextResumesOn,
        isCurrent: term.isCurrent,
      })
      .from(term)
      .innerJoin(academicSession, owns(academicSession, eq(academicSession.id, term.sessionId)))
      .where(owns(term))
      .orderBy(desc(academicSession.name), desc(term.number));
    return rows.map((r) => ({ ...r, label: termLabel(r.number, r.sessionName) }));
  });
}

export async function getCurrentTerm(scope: TenantScope): Promise<TermWithSession | null> {
  const terms = await listTerms(scope);
  return terms.find((t) => t.isCurrent) ?? terms[0] ?? null;
}
