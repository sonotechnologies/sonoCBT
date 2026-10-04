import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { can } from "@/lib/auth/permissions";
import { getCurrentTerm } from "@/lib/data/terms";
import { subjectOffering } from "@/lib/db/schema";
import { releaseOverview } from "@/lib/results/pipeline";
import { requireStaff } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "CA & broadsheet" };

/** Classes this person enters scores for (or all, for the exam officer and admin). */
export default async function ResultClassesPage({ params }: PageProps<"/s/[schoolSlug]/results/classes">) {
  const { schoolSlug } = await params;
  const ctx = await requireStaff(schoolSlug);
  const term = await getCurrentTerm(ctx.scope);
  if (!term) return <main className="p-8 text-sm text-ink-2">Set up a session and term first.</main>;
  const { rows, statusWord } = await releaseOverview(ctx.scope, term.id);
  const all = can(ctx.actor, "results.review", { schoolId: ctx.school.id }) || can(ctx.actor, "marks.moderate", { schoolId: ctx.school.id });
  const mine = new Set((await ctx.scope.findMany(subjectOffering, eq(subjectOffering.teacherId, ctx.user.id))).map((o) => o.classArmId));
  for (const r of ctx.actor.roles) if (r.role === "form_teacher" && r.classArmId) mine.add(r.classArmId);
  const shown = rows.filter((r) => all || mine.has(r.classArmId));

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="border-b border-border bg-card px-4 py-5 lg:px-8">
        <div className="text-[13px] font-semibold text-muted-foreground">CA &amp; broadsheet · {term.label}</div>
        <h1 className="mt-0.5 text-2xl font-extrabold">Your classes</h1>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 p-4 lg:p-8">
        {shown.length === 0 && <p className="text-sm text-ink-2">You aren&apos;t down to teach any class this term. The admin sets this in Staff → Who teaches what.</p>}
        {shown.map((r) => (
          <Link key={r.classArmId} href={`/s/${schoolSlug}/results/classes/${r.classArmId}`} className="flex flex-col gap-2 rounded-xl border border-border bg-card px-5 py-4 text-foreground no-underline hover:border-ink">
            <span className="flex items-center gap-2">
              <span className="flex-1 text-lg font-extrabold">{r.name}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", r.status === "draft" ? "bg-chip" : r.status === "under_review" ? "bg-[#EAF1F9] text-[#1D4B80]" : "bg-[#E8F4EC] text-[#155E34]")}>{statusWord[r.status]}</span>
            </span>
            <span className="text-[13px] text-muted-foreground">
              {r.students} students · {r.subjectsReady} of {r.subjectsTotal} subjects complete
            </span>
            <span className="h-1.5 overflow-hidden rounded-[3px] bg-chip">
              <span className="block h-full bg-ink" style={{ width: `${r.subjectsTotal ? Math.round((r.subjectsReady / r.subjectsTotal) * 100) : 0}%` }} />
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
