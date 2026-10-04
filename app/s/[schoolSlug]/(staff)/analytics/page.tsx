import type { Metadata } from "next";
import { Locked } from "@/components/billing/locked";
import { getBilling } from "@/lib/billing/context";
import { hasFeature } from "@/lib/billing/state";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, lte } from "drizzle-orm";
import { exam } from "@/lib/db/schema";
import { ExamReportView } from "@/components/analytics/exam-report";
import { Picker } from "@/components/analytics/picker";
import { SchoolView } from "@/components/analytics/school-view";
import { TopicView } from "@/components/analytics/topic-view";
import { analyticsAccess, AnalyticsError } from "@/lib/analytics/access";
import { analysableExams, examReport } from "@/lib/analytics/exam";
import { schoolOverview } from "@/lib/analytics/school";
import { refreshExamStats } from "@/lib/analytics/stats";
import { orderedTerms } from "@/lib/analytics/terms";
import { topicMastery } from "@/lib/analytics/topics";
import { formatDate } from "@/lib/format";
import { requireStaff } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Analytics" };

const TABS = [
  ["exam", "Exam report"],
  ["topic", "Topic mastery"],
  ["school", "School overview"],
] as const;
type Tab = (typeof TABS)[number][0];

export default async function AnalyticsPage({ params, searchParams }: PageProps<"/s/[schoolSlug]/analytics">) {
  const { schoolSlug } = await params;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const ctx = await requireStaff(schoolSlug);
  const access = await analyticsAccess(ctx.scope, ctx.actor);
  if (!access) notFound();
  const billing = await getBilling(ctx.school.id);
  if (!hasFeature(billing, "analytics")) {
    return (
      <main className="min-w-0 flex-1 px-4 lg:px-10">
        <Locked feature="analytics" billing={billing} slug={schoolSlug} canManage={ctx.actor.roles.some((r) => r.role === "school_admin")} />
      </main>
    );
  }

  const tabs = TABS.filter(([k]) => k !== "school" || access.schoolWide);
  const tab: Tab = tabs.some(([k]) => k === one("tab")) ? (one("tab") as Tab) : "exam";
  const terms = (await orderedTerms(ctx.scope)).reverse();
  const term = terms.find((t) => t.id === one("term")) ?? terms.find((t) => t.isCurrent) ?? terms[0];
  const base = `/s/${schoolSlug}/analytics`;
  const exportUrl = (table: string, extra: Record<string, string>) => `${base}/export?${new URLSearchParams({ table, ...extra })}`;

  let exams: Awaited<ReturnType<typeof analysableExams>> = [];
  let report: Awaited<ReturnType<typeof examReport>> | null = null;
  let mastery: Awaited<ReturnType<typeof topicMastery>> | null = null;
  let overview: Awaited<ReturnType<typeof schoolOverview>> | null = null;
  let problem: string | null = null;
  try {
    if (tab === "exam") {
      exams = await analysableExams(ctx.scope, access);
      const examId = exams.find((e) => e.id === one("exam"))?.id ?? exams[0]?.id;
      if (examId) {
        // Once an exam has closed its answers are final; keep the bank's question statistics in step.
        const closed = await ctx.scope.findFirst(exam, and(eq(exam.id, examId), lte(exam.windowEnd, new Date()))!);
        if (closed) await refreshExamStats(ctx.scope, examId);
        report = await examReport(ctx.scope, access, examId);
      }
      else problem = "No exams with handed-in scripts in your subjects yet. Reports appear here once students sit a CBT exam.";
    } else if (term && tab === "topic") mastery = await topicMastery(ctx.scope, access, { termId: term.id, subjectId: one("subject") });
    else if (term && tab === "school") overview = await schoolOverview(ctx.scope, access, term.id);
    else problem = "Set up a session and term first.";
  } catch (e) {
    if (!(e instanceof AnalyticsError)) throw e;
    problem = e.message;
  }

  const termOptions = terms.map((t) => ({ id: t.id, label: t.label }));
  let pickers: React.ReactNode = null;
  let body: React.ReactNode = null;
  if (report) {
    const examId = report.exam.id;
    pickers = <Picker name="exam" label="Exam" value={examId} options={exams.map((e) => ({ id: e.id, label: `${e.title} · ${formatDate(e.windowStart)}` }))} />;
    body = <ExamReportView r={report} csv={(table) => exportUrl(table, { exam: examId })} />;
  } else if (mastery && term) {
    pickers = (
      <>
        {mastery.subject && <Picker name="subject" label="Subject" value={mastery.subject.id} options={mastery.subjects.map((x) => ({ id: x.id, label: x.name }))} />}
        <Picker name="term" label="Term" value={term.id} options={termOptions} reset={["subject"]} />
      </>
    );
    body = <TopicView m={mastery} csv={exportUrl("topics", { term: term.id, ...(mastery.subject ? { subject: mastery.subject.id } : {}) })} />;
  } else if (overview && term) {
    pickers = <Picker name="term" label="Term" value={term.id} options={termOptions} />;
    body = <SchoolView o={overview} csv={(table) => exportUrl(table, { term: term.id })} />;
  }
  const title = TABS.find(([k]) => k === tab)![1];

  return (
    <main className="min-w-0 flex-1">
      <div className="border-b border-border bg-card px-4 pt-5 lg:px-10">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[200px] flex-1">
            <div className="text-[13px] font-semibold text-muted-foreground">Analytics{access.schoolWide ? "" : " · your subjects"}</div>
            <h1 className="mt-0.5 text-2xl font-extrabold">{title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">{pickers}</div>
        </div>
        <nav aria-label="Analytics" className="mt-3.5 flex gap-1">
          {tabs.map(([k, label]) => (
            <Link
              key={k}
              href={`${base}?tab=${k}${term && k !== "exam" ? `&term=${term.id}` : ""}`}
              aria-current={k === tab ? "page" : undefined}
              className={cn("flex h-11 items-center px-4 text-sm text-foreground no-underline", k === tab ? "font-extrabold shadow-[inset_0_-3px_0_var(--color-ink)]" : "font-semibold")}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex max-w-[1320px] flex-col gap-5 px-4 pt-7 pb-12 lg:px-10">{problem ? <p className="text-sm text-ink-2">{problem}</p> : body}</div>
    </main>
  );
}
