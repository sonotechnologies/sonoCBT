import type { Metadata } from "next";
import { Locked } from "@/components/billing/locked";
import { getBilling } from "@/lib/billing/context";
import { hasFeature } from "@/lib/billing/state";
import Link from "next/link";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { can } from "@/lib/auth/permissions";
import { getCurrentTerm, listTerms } from "@/lib/data/terms";
import { reportCardExtras } from "@/lib/db/schema";
import { releaseOverview, studentsInArm } from "@/lib/results/pipeline";
import { requireStaff } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Report cards" };

/** Classes whose report cards this person fills in or prints: their own form class, or all for the admin and exam officer. */
export default async function ReportCardsPage({ params, searchParams }: PageProps<"/s/[schoolSlug]/report-cards">) {
  const { schoolSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireStaff(schoolSlug);
  const billing = await getBilling(ctx.school.id);
  if (!hasFeature(billing, "report_cards")) {
    return (
      <main className="min-w-0 flex-1 px-4 lg:px-10">
        <Locked feature="report_cards" billing={billing} slug={schoolSlug} canManage={ctx.actor.roles.some((r) => r.role === "school_admin")} />
      </main>
    );
  }
  const terms = await listTerms(ctx.scope);
  const term = terms.find((t) => t.id === sp.term) ?? (await getCurrentTerm(ctx.scope));
  if (!term) return <main className="p-8 text-sm text-ink-2">Set up a session and term first.</main>;
  const { rows, statusWord } = await releaseOverview(ctx.scope, term.id);
  const all = can(ctx.actor, "results.review", { schoolId: ctx.school.id }) || can(ctx.actor, "results.release", { schoolId: ctx.school.id });
  const mine = new Set(ctx.actor.roles.filter((r) => r.role === "form_teacher" && r.classArmId).map((r) => r.classArmId!));
  const shown = rows.filter((r) => all || mine.has(r.classArmId));
  const remarks = await Promise.all(
    shown.map(async (r) => {
      const ids = (await studentsInArm(ctx.scope, term.id, r.classArmId)).map((s) => s.id);
      if (!ids.length) return 0;
      return (await ctx.scope.findMany(reportCardExtras, and(eq(reportCardExtras.termId, term.id), inArray(reportCardExtras.studentId, ids), isNotNull(reportCardExtras.formTeacherRemark))!)).length;
    }),
  );

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end gap-4 border-b border-border bg-card px-4 py-5 lg:px-8">
        <div className="min-w-[220px] flex-1">
          <div className="text-[13px] font-semibold text-muted-foreground">Report cards · {term.label}</div>
          <h1 className="mt-0.5 text-2xl font-extrabold">Remarks, ratings &amp; printing</h1>
        </div>
        {terms.length > 1 && (
          <nav aria-label="Term" className="flex flex-wrap gap-1.5">
            {terms.slice(0, 4).map((t) => (
              <Link
                key={t.id}
                href={`?term=${t.id}`}
                aria-current={t.id === term.id ? "page" : undefined}
                className={cn("h-9 rounded-md border px-3 text-[13px] leading-[34px] font-semibold no-underline", t.id === term.id ? "border-ink bg-ink text-white" : "border-border bg-card text-foreground")}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 p-4 lg:p-8">
        {shown.length === 0 && <p className="text-sm text-ink-2">You aren&apos;t a form teacher this term. The admin sets form teachers in School setup → Classes.</p>}
        {shown.map((r, n) => (
          <Link key={r.classArmId} href={`/s/${schoolSlug}/report-cards/${r.classArmId}?term=${term.id}`} className="flex flex-col gap-2 rounded-xl border border-border bg-card px-5 py-4 text-foreground no-underline hover:border-ink">
            <span className="flex items-center gap-2">
              <span className="flex-1 text-lg font-extrabold">{r.name}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-semibold",
                  r.status === "released" || r.status === "approved" ? "bg-[#E8F4EC] text-[#155E34]" : r.status === "under_review" ? "bg-[#EAF1F9] text-[#1D4B80]" : "bg-chip",
                )}
              >
                {statusWord[r.status]}
              </span>
            </span>
            <span className="text-[13px] text-muted-foreground">
              {r.students} students · {remarks[n]} of {r.students} form teacher&apos;s remarks
            </span>
            <span className="h-1.5 overflow-hidden rounded-[3px] bg-chip">
              <span className="block h-full bg-ink" style={{ width: `${r.students ? Math.round((remarks[n] / r.students) * 100) : 0}%` }} />
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
