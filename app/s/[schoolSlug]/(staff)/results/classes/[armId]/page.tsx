import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { BatchButton } from "@/components/results/batch-button";
import { CaGrid } from "@/components/results/ca-grid";
import { can } from "@/lib/auth/permissions";
import { getCurrentTerm, listTerms } from "@/lib/data/terms";
import { subject, subjectOffering } from "@/lib/db/schema";
import { ordinal } from "@/lib/grading";
import { batchFor, broadsheet, canEnterScores, gridData, ResultsError } from "@/lib/results/pipeline";
import { requireStaff } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "CA & broadsheet" };

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-chip text-ink-2" },
  under_review: { label: "In review", cls: "bg-[#EAF1F9] text-[#1D4B80]" },
  approved: { label: "Approved", cls: "bg-[#E8F4EC] text-[#155E34]" },
  released: { label: "Released", cls: "bg-[#E8F4EC] text-[#155E34]" },
};

export default async function ClassResultsPage({ params, searchParams }: PageProps<"/s/[schoolSlug]/results/classes/[armId]">) {
  const { schoolSlug, armId } = await params;
  const sp = await searchParams;
  const ctx = await requireStaff(schoolSlug);
  const terms = await listTerms(ctx.scope);
  const term = terms.find((t) => t.id === sp.term) ?? (await getCurrentTerm(ctx.scope));
  if (!term) notFound();
  const view = sp.view === "bs" ? "bs" : "ca";

  // Subjects this class takes; the ones this person enters come first.
  const offerings = await ctx.scope.findMany(subjectOffering, eq(subjectOffering.classArmId, armId));
  const subjects = (await ctx.scope.findMany(subject)).filter((s) => offerings.some((o) => o.subjectId === s.id)).sort((a, b) => a.sortOrder - b.sortOrder);
  const mine: string[] = [];
  for (const s of subjects) if ((await canEnterScores(ctx.scope, ctx.actor, armId, s.id)).enter) mine.push(s.id);
  const subjectId = subjects.some((s) => s.id === sp.subject) ? String(sp.subject) : (mine[0] ?? subjects[0]?.id);
  const qs = (over: Record<string, string>) => `?${new URLSearchParams({ term: term.id, view, ...(subjectId ? { subject: subjectId } : {}), ...over })}`;

  let grid: Awaited<ReturnType<typeof gridData>> | null = null;
  let bs: Awaited<ReturnType<typeof broadsheet>> | null = null;
  let problem: string | null = null;
  let status = "draft";
  try {
    const batch = await batchFor(ctx.scope, term.id, armId);
    status = batch.status;
    if (view === "ca") {
      if (!subjectId) throw new ResultsError("This class has no subjects yet. Add them in School setup → Classes & subjects.");
      grid = await gridData(ctx.scope, ctx.actor, term.id, armId, subjectId);
    } else bs = await broadsheet(ctx.scope, ctx.actor, term.id, armId);
  } catch (e) {
    if (!(e instanceof ResultsError)) throw e;
    if (e.message === "Class not found.") notFound();
    problem = e.message;
  }
  const armName = grid?.arm.name ?? bs?.arm.name ?? "";
  const g = grid;
  const ranked = bs ? [...bs.students].sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || a.name.localeCompare(b.name)) : [];
  const body: React.ReactNode = problem ? (
    <p className="p-8 text-sm text-ink-2">{problem}</p>
  ) : g && subjectId && g.components.length ? (
    <CaGrid key={`${term.id}:${subjectId}`} slug={schoolSlug} termId={term.id} classArmId={armId} subjectId={subjectId} components={g.components} students={g.students} bands={g.bands} canEdit={g.canEdit} needsReason={g.needsReason} />
  ) : g ? (
    <p className="p-8 text-sm text-ink-2">This term has no result components yet. The school admin sets them in Results → Setup.</p>
  ) : bs ? (

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 overflow-auto">
            <table className="min-w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  <th scope="col" className="sticky top-0 left-0 z-30 h-[92px] min-w-[200px] border-r border-b border-r-[#D5D2C8] border-b-[#D5D2C8] bg-secondary px-2.5 text-left align-bottom text-xs font-bold text-ink-2">
                    Student
                  </th>
                  {bs.subjects.map((s) => (
                    <th key={s.id} scope="col" title={s.ready ? "All scores in" : "Some scores missing"} className="sticky top-0 z-20 h-[92px] min-w-[52px] border-r border-b border-r-border border-b-[#D5D2C8] bg-secondary px-2.5 py-2 text-center align-bottom text-xs font-bold text-ink-2">
                      <span className="inline-block rotate-180 whitespace-nowrap [writing-mode:vertical-rl]">{s.shortName}</span>
                    </th>
                  ))}
                  {["Total", "Avg", "Pos."].map((h) => (
                    <th key={h} scope="col" className="sticky top-0 z-20 h-[92px] min-w-[64px] border-r border-b border-r-border border-b-[#D5D2C8] bg-secondary px-2.5 text-right align-bottom text-xs font-bold text-ink-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ranked.map((st) => (
                  <tr key={st.id}>
                    <th scope="row" className="sticky left-0 h-10 border-r border-b border-r-[#D5D2C8] border-b-divider bg-card px-2.5 text-left font-semibold whitespace-nowrap">
                      {st.name}
                    </th>
                    {bs.subjects.map((s) => {
                      const v = st.subjects[s.id];
                      return (
                        <td
                          key={s.id}
                          title={!v ? "Missing" : v.complete ? `${v.grade} · ${ordinal(v.position)} in ${s.name}` : "Some parts still missing, so this total isn't final"}
                          className={cn(
                            "border-r border-b border-r-divider border-b-divider px-2.5 text-right font-mono",
                            !v ? "bg-[#FDF1E6] font-bold text-[#8A430B]" : !v.complete ? "bg-card text-muted-foreground italic" : v.total < 40 ? "bg-[#FBEAE9] font-bold text-[#A1271F]" : "bg-card",
                          )}
                        >
                          {v ? v.total : "—"}
                        </td>
                      );
                    })}
                    <td className="border-r border-b border-r-divider border-b-divider bg-background px-2.5 text-right font-mono font-bold">{st.total ?? "—"}</td>
                    <td className="border-r border-b border-r-divider border-b-divider bg-background px-2.5 text-right font-mono font-bold">{st.average?.toFixed(1) ?? "—"}</td>
                    <td className={cn("border-b border-b-divider px-2.5 text-right font-mono font-bold", st.position !== null && st.position <= 3 ? "bg-[#FFF4CC]" : "bg-background")}>{st.position ? ordinal(st.position) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-6 border-t border-border bg-card px-4 py-3 text-[13px] lg:px-8">
            <span>
              Totals out of 100 per subject · {bs.numberInClass} in class · {bs.subjectsReady} of {bs.subjects.length} subjects complete
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px] border-[1.5px] border-destructive bg-[#FBEAE9]" />
              Below 40 (fail) — bold
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px] border-[1.5px] border-warning bg-[#FDF1E6]" />
              Missing score
            </span>
            <span className="text-muted-foreground italic">Grey italic: some parts not in yet</span>
          </div>
        </div>
      
  ) : null;

  const canSubmit =
    status === "draft" &&
    (can(ctx.actor, "results.review", { schoolId: ctx.school.id }) || can(ctx.actor, "marks.moderate", { schoolId: ctx.school.id }) || ctx.actor.roles.some((r) => r.role === "form_teacher" && r.classArmId === armId));
  const subjName = subjects.find((s) => s.id === subjectId)?.name;

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-4 border-b border-border bg-card px-4 py-[18px] lg:px-8">
        <div className="min-w-[240px] flex-1">
          <div className="text-[13px] font-semibold text-muted-foreground">
            <Link href={`/s/${schoolSlug}/results/classes`} className="text-muted-foreground">
              {armName || "Class"}
            </Link>{" "}
            · {term.label}
          </div>
          <h1 className="mt-0.5 text-[22px] font-extrabold">{view === "ca" ? `${subjName ?? ""} · CA scores` : "Class broadsheet"}</h1>
        </div>
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", STATUS[status].cls)}>{STATUS[status].label}</span>
        <nav aria-label="View" className="flex rounded-md bg-secondary p-[3px]">
          {(
            [
              ["ca", "CA scores"],
              ["bs", "Broadsheet"],
            ] as const
          ).map(([v, l]) => (
            <Link key={v} href={qs({ view: v })} aria-current={view === v ? "page" : undefined} className={cn("h-[38px] rounded-[6px] px-3.5 text-sm leading-[38px] font-bold text-foreground no-underline", view === v ? "bg-card" : "")}>
              {l}
            </Link>
          ))}
        </nav>
        {canSubmit && (
          <BatchButton
            slug={schoolSlug}
            termId={term.id}
            armIds={[armId]}
            action="submit"
            label="Send for review"
            confirmText={`Send ${armName} for review? Teachers can't change scores after this unless the exam officer sends it back.`}
          />
        )}
      </div>
      {view === "ca" && subjects.length > 0 && (
        <nav aria-label="Subject" className="flex gap-1.5 overflow-x-auto border-b border-border bg-background px-4 py-2.5 lg:px-8">
          {subjects.map((s) => (
            <Link
              key={s.id}
              href={qs({ subject: s.id })}
              aria-current={s.id === subjectId ? "page" : undefined}
              className={cn(
                "h-[34px] rounded-md border px-3 text-[13px] leading-[32px] font-semibold whitespace-nowrap no-underline",
                s.id === subjectId ? "border-ink bg-ink text-white" : "border-border bg-card text-foreground",
                !mine.includes(s.id) && "opacity-70",
              )}
            >
              {s.name}
            </Link>
          ))}
        </nav>
      )}
      {body}
    </main>
  );
}
