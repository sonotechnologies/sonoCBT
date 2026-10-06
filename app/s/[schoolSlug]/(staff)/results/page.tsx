import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReleaseClient } from "@/components/results/release-client";
import { buttonVariants } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { getCurrentTerm, listTerms } from "@/lib/data/terms";
import { changeLog, releaseOverview } from "@/lib/results/pipeline";
import { requireStaff } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Release results" };

const stamp = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d).replace(",", " ·");

export default async function ResultsPage({ params, searchParams }: PageProps<"/s/[schoolSlug]/results">) {
  const { schoolSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireStaff(schoolSlug);
  const canReview = can(ctx.actor, "results.review", { schoolId: ctx.school.id });
  const canRelease = can(ctx.actor, "results.release", { schoolId: ctx.school.id });
  if (!canReview && !canRelease) notFound();
  const terms = await listTerms(ctx.scope);
  const term = terms.find((t) => t.id === sp.term) ?? (await getCurrentTerm(ctx.scope));
  if (!term) return <main className="p-8 text-sm text-ink-2">Set up a session and term first.</main>;
  const { rows } = await releaseOverview(ctx.scope, term.id);
  const logArm = typeof sp.log === "string" && rows.some((r) => r.classArmId === sp.log) ? sp.log : null;
  const log = logArm ? await changeLog(ctx.scope, term.id, logArm) : [];

  return (
    <main className="min-w-0 flex-1 overflow-auto">
      <div className="flex max-w-[1240px] flex-col gap-6 px-4 pt-7 pb-12 lg:px-10">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-muted-foreground">Results · {term.label}</div>
            <h1 className="mt-1 text-[28px] font-extrabold">Release results</h1>
          </div>
          {terms.length > 1 && (
            <nav aria-label="Term" className="chip-row flex w-full flex-wrap gap-1.5 sm:w-auto">
              {terms.slice(0, 4).map((t) => (
                <Link key={t.id} href={`?term=${t.id}`} aria-current={t.id === term.id ? "page" : undefined} className={cn("flex h-10 items-center rounded-md border px-3 text-[13px] font-semibold whitespace-nowrap no-underline sm:h-9", t.id === term.id ? "border-ink bg-ink text-white" : "border-border bg-card text-foreground")}>
                  {t.label}
                </Link>
              ))}
            </nav>
          )}
          {can(ctx.actor, "resultPins.manage", { schoolId: ctx.school.id }) && (
            <Link href={`/s/${schoolSlug}/results/pins?term=${term.id}`} className={cn(buttonVariants({ variant: "outline", size: "md" }))}>
              PINs
            </Link>
          )}
          {can(ctx.actor, "school.manage", { schoolId: ctx.school.id }) && (
            <Link href={`/s/${schoolSlug}/results/setup?term=${term.id}`} className={cn(buttonVariants({ variant: "outline", size: "md" }))}>
              Setup
            </Link>
          )}
        </div>
        <ReleaseClient slug={schoolSlug} termId={term.id} rows={rows.map((r) => ({ ...r, lastAt: r.lastAt ? r.lastAt.toISOString() : null }))} canReview={canReview} canRelease={canRelease} logArm={logArm} />
        {logArm && (
          <section className="rounded-xl border border-border bg-card" aria-label="Change log">
            <div className="border-b border-divider px-5 py-4 text-base font-extrabold">Change log · {rows.find((r) => r.classArmId === logArm)?.name}</div>
            {log.length === 0 && <p className="px-5 py-4 text-sm text-muted-foreground">Nothing has changed yet.</p>}
            {log.map((l, i) => (
              <div key={i} className="grid grid-cols-[120px_180px_minmax(0,1fr)] gap-3 border-b border-divider px-5 py-3 text-[13px] last:border-b-0">
                <span className="font-mono text-muted-foreground">{stamp(l.at)}</span>
                <b>{l.who}</b>
                <span>{l.what}</span>
              </div>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
