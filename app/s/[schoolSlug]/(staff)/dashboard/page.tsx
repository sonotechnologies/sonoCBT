import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { greetingName, staffDashboard, type ExamRow } from "@/lib/dashboard/service";
import { setupProgress } from "@/lib/school/progress";
import { WIZARD_STEPS } from "@/lib/school/wizard";
import { requireStaff } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

const STATUS: Record<ExamRow["status"], { label: string; chip: string; dot: string }> = {
  live: { label: "Live now", chip: "bg-[#FFF4CC] text-[#6B5200]", dot: "bg-pencil border-ink" },
  scheduled: { label: "Scheduled", chip: "bg-[#EEF0F5] text-[#3E4760]", dot: "border-[#8C93A3]" },
  marking: { label: "Marking", chip: "bg-[#E8F4EC] text-[#155E34]", dot: "bg-[#1F8A4C] border-[#1F8A4C]" },
  done: { label: "Done", chip: "bg-[#E8F4EC] text-[#155E34]", dot: "bg-[#1F8A4C] border-[#1F8A4C]" },
  draft: { label: "Not published", chip: "bg-[#FDF1E6] text-[#8A430B]", dot: "border-[#D9731A]" },
};
const TONE = { warn: "bg-[#D9731A] rounded-[2px]", info: "bg-[#2F6FB5] rounded-full", quiet: "bg-[#8C93A3] rounded-full" };
const BARS: [keyof Omit<import("@/lib/dashboard/service").LevelRow, "level" | "label">, string, string][] = [
  ["released", "Released", "#1F8A4C"],
  ["approved", "Approved", "#8FCBA6"],
  ["review", "In review", "#2F6FB5"],
  ["draft", "Draft", "#C9CCD4"],
];

export default async function DashboardPage({ params }: PageProps<"/s/[schoolSlug]/dashboard">) {
  const { schoolSlug } = await params;
  const ctx = await requireStaff(schoolSlug);
  const base = `/s/${schoolSlug}`;
  const d = await staffDashboard(ctx.scope, ctx.actor);

  const showSetup = !ctx.school.onboardingCompletedAt && can(ctx.actor, "school.manage", { schoolId: ctx.school.id });
  const progress = showSetup ? await setupProgress(ctx.scope, ctx.school) : null;
  const doneCount = progress ? Object.values(progress).filter(Boolean).length : 0;
  const nextStep = progress ? (WIZARD_STEPS.find((s) => !progress[s.slug]) ?? WIZARD_STEPS.at(-1)!) : null;

  return (
    <main className="min-w-0 flex-1">
      <div className="flex max-w-[1360px] flex-col gap-6 px-4 pt-8 pb-12 lg:px-10">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[260px] flex-1">
            <div className="text-[13px] font-semibold text-muted-foreground">{d.dateLine}</div>
            <h1 className="mt-1.5 text-[30px] font-extrabold">
              {d.hello}, {greetingName(ctx.user.name)}
            </h1>
          </div>
          <nav aria-label="Quick actions" className="flex flex-wrap gap-2.5">
            {d.quick.map((q) => (
              <Link
                key={q.t}
                href={`${base}/${q.href}`}
                className={cn("flex h-11 items-center rounded-lg border-[1.5px] px-4 text-sm font-bold no-underline", q.primary ? "border-ink bg-ink text-white" : "border-input bg-card text-foreground")}
              >
                {q.t}
              </Link>
            ))}
          </nav>
        </div>

        {showSetup && nextStep && (
          <section className="flex flex-wrap items-center gap-4 rounded-xl bg-ink p-5 text-white">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-pencil">
                SETUP · {doneCount} OF {WIZARD_STEPS.length} DONE
              </p>
              <h2 className="mt-1 text-lg font-extrabold">Finish setting up {ctx.school.name}</h2>
              <p className="text-[13px] text-on-ink-muted">Next: {nextStep.title.toLowerCase()}.</p>
            </div>
            <Link href={`${base}/setup/${nextStep.slug}`} className={cn(buttonVariants({ variant: "pencil", size: "lg" }))}>
              Continue setup
            </Link>
          </section>
        )}

        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {d.stats.map((s) => (
            <div key={s.k} className="rounded-xl border border-border bg-card p-5">
              <dt className="text-[13px] text-muted-foreground">{s.k}</dt>
              <dd className="mt-1.5 font-mono text-[30px] font-semibold">{s.v}</dd>
              <dd className="mt-1 truncate text-[13px] text-ink-2" title={s.d}>
                {s.d}
              </dd>
            </div>
          ))}
        </dl>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <section aria-labelledby="exams-h" className="rounded-xl border border-border bg-card">
            <div className="flex items-center border-b border-divider px-5 py-[18px]">
              <h2 id="exams-h" className="flex-1 text-[17px] font-extrabold">
                Exams today and this week
              </h2>
              <Link href={`${base}/exams`} className="text-[13px] font-bold">
                All exams
              </Link>
            </div>
            {d.exams.length ? (
              <ul>
                {d.exams.map((e) => (
                  <li key={e.id} className="border-b border-divider last:border-b-0">
                    <Link href={`${base}/${e.href}`} className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3.5 px-5 py-3.5 text-foreground no-underline hover:bg-background sm:grid-cols-[96px_minmax(0,1fr)_110px_120px]">
                      <div>
                        <div className="font-mono text-sm font-semibold">{e.time}</div>
                        <div className="text-xs text-muted-foreground">{e.day}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold">{e.title}</div>
                        <div className="truncate text-xs text-muted-foreground">{e.detail}</div>
                      </div>
                      <div className="hidden font-mono text-[13px] text-ink-2 sm:block">{e.count}</div>
                      <span className={cn("flex h-[26px] items-center gap-1.5 justify-self-end rounded-full px-2.5 text-xs font-bold whitespace-nowrap", STATUS[e.status].chip)}>
                        <span className={cn("size-[7px] rounded-full border-[1.5px]", STATUS[e.status].dot)} />
                        {STATUS[e.status].label}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-muted-foreground">No exams this week.</p>
            )}
          </section>

          <section aria-labelledby="alerts-h" className="rounded-xl border border-border bg-card">
            <h2 id="alerts-h" className="border-b border-divider px-5 py-[18px] text-[17px] font-extrabold">
              Needs your attention
            </h2>
            {d.alerts.length ? (
              <ul>
                {d.alerts.map((a) => (
                  <li key={a.title} className="flex gap-3 border-b border-divider px-5 py-3.5 last:border-b-0">
                    <span className={cn("mt-[5px] size-2.5 flex-none", TONE[a.tone])} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold">{a.title}</div>
                      <div className="mt-0.5 text-[13px] leading-snug text-ink-2">{a.detail}</div>
                    </div>
                    <Link href={`${base}/${a.href}`} className="text-[13px] font-bold whitespace-nowrap">
                      {a.cta}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-muted-foreground">Nothing needs you right now.</p>
            )}
          </section>
        </div>

        {d.resultsVisible && (
          <section aria-labelledby="results-h" className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-4 border-b border-divider px-5 py-[18px]">
              <h2 id="results-h" className="flex-1 text-[17px] font-extrabold">
                {d.termName} results by class
              </h2>
              <div className="flex flex-wrap gap-3.5 text-xs text-ink-2">
                {BARS.map(([, label, color]) => (
                  <span key={label} className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px]" style={{ background: color }} />
                    {label}
                  </span>
                ))}
              </div>
            </div>
            {d.levels.length ? (
              <ul>
                {d.levels.map((l) => {
                  const total = l.released + l.approved + l.review + l.draft;
                  return (
                    <li key={l.level} className="grid grid-cols-[80px_minmax(0,1fr)_150px] items-center border-b border-divider last:border-b-0 sm:grid-cols-[120px_minmax(0,1fr)_210px]">
                      <span className="px-5 py-3 text-sm font-bold">{l.level}</span>
                      <span
                        className="flex h-3.5 overflow-hidden rounded-[7px] bg-[#EEF0F5]"
                        role="img"
                        aria-label={`${l.level}: ${BARS.map(([k, label]) => `${l[k]} ${label.toLowerCase()}`).join(", ")} subjects`}
                      >
                        {BARS.map(([k, , color]) => (l[k] ? <span key={k} className="h-full" style={{ width: `${(l[k] / total) * 100}%`, background: color }} /> : null))}
                      </span>
                      <span className="px-5 py-3 text-right text-[13px] whitespace-nowrap text-ink-2">{l.label}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-muted-foreground">No classes have subjects yet. Add them in School setup.</p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
