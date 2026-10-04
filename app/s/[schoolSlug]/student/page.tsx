import type { Metadata } from "next";
import { DemoBanner } from "@/components/demo/banner";
import { getBilling } from "@/lib/billing/context";
import { hasFeature } from "@/lib/billing/state";
import Link from "next/link";
import { OpensLabel } from "@/components/exam/opens-label";
import { buttonVariants } from "@/components/ui/button";
import { Photo } from "@/components/ui/photo";
import { signOut } from "@/lib/auth/actions";
import { getClassArmName, hasSubmitted, listReleasedScores, listStudentExams } from "@/lib/data/exams";
import { comingUpSummary, examPhase, isToday, todaySummary } from "@/lib/exams/present";
import { dayMonth, formatDate, num } from "@/lib/format";
import { releasedTermsFor } from "@/lib/results/report-card";
import { requireStudent } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Home" };

const COMING_UP_LIMIT = 5;

export default async function StudentHomePage({ params }: PageProps<"/s/[schoolSlug]/student">) {
  const { schoolSlug } = await params;
  const ctx = await requireStudent(schoolSlug);
  const { student, scope, school } = ctx;
  const now = new Date();

  const [exams, released, armName, reportCards] = await Promise.all([
    listStudentExams(scope, student),
    listReleasedScores(scope, student.id),
    getClassArmName(scope, student.classArmId),
    releasedTermsFor(scope, student.id),
  ]);

  // Today's card: the next exam today that is still upcoming or open and not yet submitted.
  let today: (typeof exams)[number] | undefined;
  for (const e of exams) {
    if (!isToday(e.windowStart, now) || examPhase(e, now) === "closed") continue;
    if (await hasSubmitted(scope, e.id, student.id)) continue;
    today = e;
    break;
  }
  const upcoming = exams
    .filter((e) => e.id !== today?.id && e.windowStart > now && !isToday(e.windowStart, now))
    .slice(0, COMING_UP_LIMIT);

  return (
    <main className="flex flex-1 flex-col bg-background">
      {school.isDemo && <DemoBanner />}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[560px] items-center gap-3 px-5 pt-5 pb-4">
          <Photo src={student.photoUrl} alt="Your photo" className="size-11 rounded-full" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-extrabold">Hi, {student.firstName}</h1>
            <p className="truncate text-xs text-muted-foreground">
              {[armName, school.name].filter(Boolean).join(" · ")}
            </p>
          </div>
          <form action={signOut.bind(null, `/s/${schoolSlug}/login`)}>
            <button type="submit" className="h-10 rounded-md px-2 text-[13px] font-semibold text-ink-2 hover:bg-secondary">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3.5 p-5">
        <h2 className="eyebrow">Today</h2>
        {today ? (
          <section
            aria-labelledby="today-title"
            className="flex flex-col gap-2.5 rounded-xl bg-ink p-[18px] text-white"
          >
            <p className="text-xs font-bold text-pencil">
              <OpensLabel start={today.windowStart.getTime()} end={today.windowEnd.getTime()} serverNow={now.getTime()} />
            </p>
            <h3 id="today-title" className="text-lg font-extrabold">
              {today.title}
            </h3>
            <p className="text-[13px] text-on-ink-muted">{todaySummary(today)}</p>
            <Link
              href={`/s/${schoolSlug}/exam/${today.id}`}
              className={cn(buttonVariants({ variant: "pencil" }), "mt-1 h-12 text-[15px]")}
            >
              Go to exam lobby
            </Link>
          </section>
        ) : (
          <p className="rounded-xl border border-border bg-card p-[18px] text-sm text-ink-2">
            No exams today. Anything coming up is listed below.
          </p>
        )}

        <h2 className="eyebrow mt-2">Coming up</h2>
        {upcoming.length ? (
          <ul className="flex flex-col gap-3.5">
            {upcoming.map((e) => {
              const { day, month } = dayMonth(e.windowStart);
              return (
                <li key={e.id} className="flex items-center gap-3.5 rounded-xl border border-border bg-card p-3.5">
                  <div className="w-12 text-center">
                    <div className="font-mono text-lg font-semibold">{day}</div>
                    <div className="text-[11px] text-muted-foreground">{month}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold">{e.title}</div>
                    <div className="text-xs text-muted-foreground">{comingUpSummary(e)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing else scheduled yet.</p>
        )}

        {reportCards.length > 0 && hasFeature(await getBilling(school.id), "report_cards") && (
          <>
            <h2 className="eyebrow mt-2">Report cards</h2>
            <ul className="flex flex-col gap-3.5">
              {reportCards.map((r) => (
                <li key={r.termId} className="flex min-h-[60px] items-center gap-3.5 rounded-xl border border-border bg-card px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold">{r.label}</div>
                    {r.releasedAt && <div className="text-xs text-muted-foreground">Released {formatDate(r.releasedAt)}</div>}
                  </div>
                  <a href={`/s/${schoolSlug}/student/report-card/${r.termId}`} className={cn(buttonVariants({ variant: "outline", size: "md" }), "no-underline")}>
                    Download PDF
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}

        <h2 className="eyebrow mt-2">Released results</h2>
        {released.length ? (
          <ul className="flex flex-col gap-3.5">
            {released.map((r) => (
              <li
                key={r.examId}
                className="flex min-h-[60px] items-center gap-3.5 rounded-xl border border-border bg-card px-3.5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">{r.title}</div>
                  <div className="text-xs text-muted-foreground">Released {formatDate(r.releasedAt)}</div>
                </div>
                <div className="font-mono text-lg font-semibold">
                  {num(r.score)}/{num(r.maxScore)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Your scores appear here once your teachers release them.</p>
        )}
      </div>
    </main>
  );
}
