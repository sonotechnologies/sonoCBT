import { eq, inArray } from "drizzle-orm";
import { getBilling } from "@/lib/billing/context";
import { lockedMessage } from "@/lib/billing/gate";
import { hasFeature } from "@/lib/billing/state";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DetailsForm } from "@/components/exams/details-form";
import { IntegrityStep } from "@/components/exams/integrity-step";
import { PublishBar } from "@/components/exams/publish-bar";
import { QuestionsStep } from "@/components/exams/questions-step";
import { ScheduleStep } from "@/components/exams/schedule-step";
import { buttonVariants } from "@/components/ui/button";
import { examCandidate, student } from "@/lib/db/schema";
import { ExamError, examPhaseStatus, getBuilder, PRESETS, publishIssues, TYPE_LABEL } from "@/lib/exams/builder";
import { builderChoices } from "@/lib/exams/builder-data";
import { formatDate, formatDuration, formatTime, toLagos } from "@/lib/format";
import { privateStorageReady } from "@/lib/storage";
import { requireStaff } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Exam builder" };

const STEPS = [
  ["details", "Details"],
  ["questions", "Questions"],
  ["integrity", "Integrity"],
  ["schedule", "Schedule"],
  ["preview", "Preview"],
] as const;
type Step = (typeof STEPS)[number][0];

export default async function ExamBuilderPage({ params, searchParams }: PageProps<"/s/[schoolSlug]/exams/[id]">) {
  const { schoolSlug, id } = await params;
  const sp = await searchParams;
  const ctx = await requireStaff(schoolSlug);
  const billing = await getBilling(ctx.school.id);
  let b: Awaited<ReturnType<typeof getBuilder>>;
  try {
    b = await getBuilder(ctx.scope, ctx.actor, id);
  } catch (e) {
    if (e instanceof ExamError) notFound();
    throw e;
  }
  const e = b.exam;
  const locked = e.status !== "draft";
  const step: Step = STEPS.some(([s]) => s === sp.step) ? (sp.step as Step) : locked ? "preview" : "details";
  const stepIndex = STEPS.findIndex(([s]) => s === step);
  const phase = examPhaseStatus(e, new Date());
  const choices = await builderChoices(ctx.scope);
  const settings = {
    integrity: e.integrity,
    integritySettings: e.integritySettings ?? PRESETS[e.integrity],
    shuffleQuestions: e.shuffleQuestions,
    shuffleOptions: e.shuffleOptions,
    showScoreAfterSubmit: e.showScoreAfterSubmit,
    calculator: e.calculator,
    pinRequired: e.pinRequired,
  };
  const levelIds = [...new Set(b.classes.map((c) => c.classLevelId))];
  const base = `/s/${schoolSlug}/exams/${id}`;

  let body: React.ReactNode = null;
  if (step === "details") {
    body = (
      <DetailsForm
        slug={schoolSlug}
        examId={id}
        locked={locked}
        choices={choices}
        initial={{
          title: e.title,
          series: e.series ?? "",
          fullTitle: e.fullTitle ?? "",
          type: e.type,
          termId: e.termId,
          subjectIds: b.subjectIds,
          classArmIds: b.classes.map((c) => c.classArmId),
          durationMinutes: e.durationMinutes,
          calculator: e.calculator,
          instructions: e.instructions ?? "",
          componentId: e.componentId,
          aiMarking: e.aiMarking,
        }}
      />
    );
  } else if (step === "questions") {
    body = (
      <QuestionsStep
        slug={schoolSlug}
        examId={id}
        sections={b.sections}
        choices={{ subjects: choices.subjects.filter((s) => b.subjectIds.includes(s.id)).concat(choices.subjects.filter((s) => !b.subjectIds.includes(s.id))), levels: choices.levels, topics: choices.topics }}
        settings={settings}
        locked={locked}
        defaultLevelId={levelIds.length === 1 ? levelIds[0] : null}
      />
    );
  } else if (step === "integrity") {
    body = <IntegrityStep slug={schoolSlug} examId={id} settings={settings} presets={PRESETS} locked={locked} snapshotsAvailable={privateStorageReady() && hasFeature(billing, "snapshots")} snapshotsNote={hasFeature(billing, "snapshots") ? null : lockedMessage(billing, "snapshots")} />;
  } else if (step === "schedule") {
    const counts = b.classes.length ? await ctx.scope.findMany(student, inArray(student.classArmId, b.classes.map((c) => c.classArmId))) : [];
    const start = toLagos(e.windowStart);
    body = (
      <ScheduleStep
        slug={schoolSlug}
        examId={id}
        locked={locked}
        durationMinutes={e.durationMinutes}
        pinRequired={e.pinRequired}
        teachers={choices.teachers}
        initial={{ date: start.date, opens: start.time, lateUntil: e.lateEntryUntil ? toLagos(e.lateEntryUntil).time : "", venue: e.venue ?? "" }}
        rooms={b.classes.map((c) => ({ classArmId: c.classArmId, name: c.name, students: counts.filter((s) => s.classArmId === c.classArmId).length, venue: c.venue ?? "", invigilatorId: c.invigilatorId ?? "" }))}
      />
    );
  } else {
    const [issues, seated] = await Promise.all([
      locked ? Promise.resolve([]) : publishIssues(ctx.scope, id),
      locked ? ctx.scope.findMany(examCandidate, eq(examCandidate.examId, id)) : Promise.resolve([]),
    ]);
    const qCount = b.sections.reduce((a, s) => a + s.questionCount, 0);
    const summary = [
      ["Classes", `${b.classes.map((c) => c.name).join(", ") || "—"}${locked ? ` · ${seated.length}` : ""}`],
      ["When", `${formatDate(e.windowStart)} · ${formatTime(e.windowStart)}`],
      ["Duration", formatDuration(e.durationMinutes)],
      ["Questions", `${qCount} · ${e.totalMarks ?? 0} marks`],
      ["Integrity", e.integrity[0].toUpperCase() + e.integrity.slice(1)],
    ];
    body = (
      <div className="flex max-w-[880px] flex-col gap-4">
        <dl className="flex flex-wrap gap-4 rounded-xl border border-border bg-card p-5">
          {summary.map(([k, v]) => (
            <div key={k} className="min-w-[130px] flex-1">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="mt-0.5 text-[15px] font-bold">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-5">
          <div className="min-w-[220px] flex-1">
            <div className="text-[15px] font-bold">See it exactly as a student will</div>
            <div className="text-[13px] text-muted-foreground">Opens the real exam screen with your questions. Nothing is saved or sent anywhere.{!locked && b.sections.some((s) => s.rules.length) ? " Random picks show a sample draw." : ""}</div>
          </div>
          <Link href={`${base}/try`} target="_blank" className={cn(buttonVariants({ variant: "outline" }))}>
            Try it as a student
          </Link>
        </div>
        <PublishBar slug={schoolSlug} examId={id} status={e.status} issues={issues} pinRequired={e.pinRequired} />
      </div>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="border-b border-border bg-card px-4 pt-5 lg:px-8">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-[220px] flex-1">
            <div className="text-[13px] font-semibold text-muted-foreground">
              <Link href={`/s/${schoolSlug}/exams`} className="text-muted-foreground">
                Exams
              </Link>{" "}
              · {TYPE_LABEL[e.type]}
            </div>
            <h1 className="mt-0.5 text-2xl font-extrabold">{e.title}</h1>
          </div>
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", phase === "draft" ? "bg-chip" : phase === "live" ? "bg-[#E8F4EC] text-[#155E34]" : phase === "closed" ? "bg-secondary text-muted-foreground" : "bg-[#EAF1F9] text-[#1D4B80]")}>
            {phase === "draft" ? `Draft · saved ${formatTime(e.updatedAt)}` : phase === "live" ? "Live now" : phase === "closed" ? "Closed" : "Scheduled"}
          </span>
          {locked && (
            <Link href={`${base}/monitor`} className={cn(buttonVariants({ variant: phase === "live" ? "pencil" : "outline", size: "md" }))}>
              Live monitor
            </Link>
          )}
          {locked && (
            <Link href={`${base}/slips`} className={cn(buttonVariants({ variant: "outline", size: "md" }))}>
              Exam slips{e.pinRequired ? " & PINs" : ""}
            </Link>
          )}
        </div>
        <nav aria-label="Steps" className="-mb-px mt-4 flex justify-between gap-1 overflow-x-auto sm:justify-start">
          {STEPS.map(([s, label], i) => {
            const current = s === step;
            const done = i < stepIndex;
            return (
              <Link
                key={s}
                href={`${base}?step=${s}`}
                aria-current={current ? "step" : undefined}
                className={cn("flex h-12 min-w-11 items-center justify-center gap-2.5 px-2 text-sm whitespace-nowrap sm:px-4 text-foreground no-underline", current ? "font-extrabold shadow-[inset_0_-3px_0_#14213D]" : "font-semibold")}
              >
                <span className={cn("flex size-6 items-center justify-center rounded-full border-2 font-mono text-xs font-semibold", done ? "border-ink bg-ink text-white" : current ? "border-ink bg-pencil" : "border-[#9AA1B0] bg-card")}>
                  {done ? "✓" : i + 1}
                </span>
                <span className={current ? undefined : "sr-only sm:not-sr-only"}>{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      {locked && (
        <p className="border-b border-[#C7D9EE] bg-[#EAF1F9] px-4 py-2.5 text-sm text-[#1D4B80] lg:px-8">
          This exam is published, so it can&apos;t be changed. Unpublish it on the Preview step to edit (only before anyone starts).
        </p>
      )}
      <div className="min-h-0 flex-1 p-4 lg:p-8">{body}</div>
      {step !== "preview" && step !== "details" && (
        <div className="flex gap-3 border-t border-border bg-card px-4 py-4 lg:px-8">
          <Link href={`${base}?step=${STEPS[stepIndex - 1][0]}`} className={cn(buttonVariants({ variant: "outline", size: "md" }))}>
            Back
          </Link>
          <span className="flex-1" />
          <Link href={`${base}?step=${STEPS[stepIndex + 1][0]}`} className={cn(buttonVariants({ size: "md" }))}>
            Continue
          </Link>
        </div>
      )}
    </main>
  );
}
