import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ForgetExamOnDevice, LobbyCountdown, StartExamButton } from "@/components/exam/lobby-live";
import { buttonVariants } from "@/components/ui/button";
import { Photo } from "@/components/ui/photo";
import { can } from "@/lib/auth/permissions";
import { getClassArmName, getSeat, listStudentExams } from "@/lib/data/exams";
import { attemptSummary, finishIfOverdue, getAttempt } from "@/lib/exams/runtime";
import { lobbyRules, type LobbyRule } from "@/lib/exams/present";
import { formatDate, formatDuration, formatTime } from "@/lib/format";
import { requireStudent } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Exam lobby" };

function Rules({ rules, size }: { rules: LobbyRule[]; size: "phone" | "lab" }) {
  return (
    <ul className={cn("flex flex-col", size === "phone" ? "gap-3 text-sm" : "gap-[22px] text-base")}>
      {rules.map((r) => (
        <li key={r.text} className={cn("flex leading-[1.45]", size === "phone" ? "gap-3" : "gap-3.5")}>
          <span
            aria-hidden
            className={cn(
              "flex-none rounded-full border-2 border-ink",
              size === "phone" ? "size-[22px]" : "size-6",
              r.highlight ? "bg-pencil" : "bg-white",
            )}
          />
          {r.text}
        </li>
      ))}
    </ul>
  );
}

export default async function LobbyPage({ params }: PageProps<"/s/[schoolSlug]/exam/[examId]">) {
  const { schoolSlug, examId } = await params;
  const { student, scope, school, actor } = await requireStudent(schoolSlug);

  // Only exams assigned to the student's class arm resolve here.
  const exam = (await listStudentExams(scope, student)).find((e) => e.id === examId);
  if (!exam || !can(actor, "exam.take", { schoolId: school.id, studentId: student.id })) notFound();

  const [seat, armName, found] = await Promise.all([
    getSeat(scope, exam.id, student.id),
    getClassArmName(scope, student.classArmId),
    getAttempt(scope, student.id, exam.id),
  ]);
  const now = new Date();
  const attempt = found ? ((await finishIfOverdue(scope, found, now)) ?? found) : null;
  const takeUrl = `/s/${schoolSlug}/exam/${exam.id}/take`;

  if (attempt && attempt.status !== "in_progress") {
    const summary = await attemptSummary(scope, attempt);
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <ForgetExamOnDevice attemptId={attempt.id} takeUrl={takeUrl} />
        <h1 className="text-2xl font-extrabold">You have submitted this exam</h1>
        <p className="max-w-sm text-[15px] text-ink-2">
          {summary.auto ? "Time ran out, so it was submitted for you. " : ""}Your answers are saved.
          {summary.score ? "" : " Your school will release results when they are ready."}
        </p>
        <dl className="grid w-full max-w-sm grid-cols-2 rounded-xl border border-border bg-card text-left">
          <div className="border-r border-border p-4">
            <dt className="text-xs text-muted-foreground">Answered</dt>
            <dd className="mt-1 font-mono text-base font-semibold">
              {summary.answered} of {summary.total}
            </dd>
          </div>
          <div className="p-4">
            <dt className="text-xs text-muted-foreground">{summary.score ? "Your score" : "Submitted"}</dt>
            <dd className="mt-1 font-mono text-base font-semibold">
              {summary.score ? `${summary.score.score} / ${summary.score.max}` : `${formatDate(new Date(summary.submittedAt))} · ${formatTime(new Date(summary.submittedAt))}`}
            </dd>
          </div>
        </dl>
        <Link href={`/s/${schoolSlug}/student`} className="font-semibold underline">
          Back to home
        </Link>
      </main>
    );
  }

  if (attempt) {
    // P8 · resume after sign-in
    const left = Math.max(0, Math.ceil((attempt.deadlineAt.getTime() - now.getTime()) / 1000));
    const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    return (
      <main className="flex flex-1 flex-col bg-background">
        <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-5 px-6 pt-8 pb-6">
          <div className="flex items-center gap-2.5 text-[13px] font-semibold text-ink-2">
            <Photo src={school.logoUrl} alt="" className="size-8 rounded-lg" />
            {[school.name, school.locality].filter(Boolean).join(", ")}
          </div>
          <div className="mt-6">
            <p className="flex items-center gap-2 text-sm font-semibold text-success">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Your answers are safe
            </p>
            <h1 className="mt-2.5 text-[28px] leading-[1.2] font-extrabold">Welcome back, {student.firstName}</h1>
            <p className="mt-3 text-base leading-relaxed text-ink-2">You left {exam.title} part-way through. Everything you answered was saved.</p>
          </div>
          <dl className="grid grid-cols-2 rounded-xl border border-border bg-card">
            <div className="border-r border-border p-4">
              <dt className="text-xs text-muted-foreground">Answered</dt>
              <dd className="mt-1 font-mono text-[22px] font-semibold">
                {attempt.answeredCount} / {attempt.questionOrder.length}
              </dd>
            </div>
            <div className="p-4">
              <dt className="text-xs text-muted-foreground">Time left</dt>
              <dd className="mt-1 font-mono text-[22px] font-semibold">{mm}</dd>
            </div>
            {attempt.lastSeenAt && (
              <div className="col-span-2 border-t border-border px-4 py-3 text-[13px] text-muted-foreground">
                Last saved at <span className="font-mono text-foreground">{formatTime(attempt.lastSeenAt)}</span> on the school server. Anything newer on your device is added when you continue.
              </div>
            )}
          </dl>
          <div className="flex-1" />
          <a href={takeUrl} className={cn(buttonVariants({ size: "xl" }), "w-full")}>
            Continue from question {Math.min(attempt.currentIndex + 1, attempt.questionOrder.length)}
          </a>
          <p className="text-center text-[13px] text-muted-foreground">Not you? Tell your invigilator.</p>
        </div>
      </main>
    );
  }

  const rules = lobbyRules(exam);
  const startTime = formatTime(exam.windowStart);
  const live = {
    start: exam.windowStart.getTime(),
    // New starts stop when late entry closes.
    end: (exam.lateEntryUntil ?? exam.windowEnd).getTime(),
    serverNow: now.getTime(),
    slug: schoolSlug,
    examId: exam.id,
    pinRequired: exam.pinRequired,
  };
  const title = exam.fullTitle ?? exam.title;
  const series = exam.series ?? exam.title;
  const where = [
    [school.name, school.locality].filter(Boolean).join(", "),
    exam.venue,
    seat && `Seat ${seat}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className="flex flex-1 flex-col bg-background">
      {/* S2 · phone */}
      <div className="flex min-h-dvh flex-col gap-[18px] px-[22px] pt-7 pb-[22px] lg:hidden">
        <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-[18px]">
          <p className="text-[13px] font-semibold text-muted-foreground">{series}</p>
          <h1 className="text-2xl leading-[1.25] font-extrabold">{title}</h1>
          <div className="rounded-xl border border-border bg-card p-[18px] text-center">
            <LobbyCountdown {...live} labelClassName="eyebrow" digitsClassName="mt-1 text-[44px] leading-tight" />
            <p className="text-[13px] text-ink-2">
              {startTime} · {exam.questionCount} questions · {formatDuration(exam.durationMinutes)}
            </p>
          </div>
          <Rules rules={rules} size="phone" />
          <div className="flex-1" />
          <StartExamButton {...live} waitingLabel={`Start exam at ${startTime}`} className="w-full" />
          <p className="text-center text-xs text-muted-foreground">Your invigilator will tell you when to begin.</p>
        </div>
      </div>

      {/* S3 · lab desktop (1366×768) */}
      <div className="hidden min-h-dvh grid-cols-2 lg:grid">
        <section className="flex flex-col gap-5 border-r border-border p-16">
          <div className="flex items-center gap-3">
            <Photo src={school.logoUrl} alt={`${school.name} logo`} className="size-11 rounded-[10px]" />
            <p className="text-sm font-semibold text-ink-2">{where}</p>
          </div>
          <p className="mt-6 text-sm font-semibold text-muted-foreground">{series}</p>
          <h1 className="text-[38px] leading-[1.2] font-extrabold">{title}</h1>
          <p className="flex flex-wrap gap-x-7 gap-y-1 text-[15px] text-ink-2">
            <span>
              <b className="text-foreground">{exam.questionCount}</b> questions
            </span>
            <span>
              <b className="text-foreground">{formatDuration(exam.durationMinutes)}</b>
            </span>
            <span>
              <b className="text-foreground">{exam.sectionCount}</b> {exam.sectionCount === 1 ? "section" : "sections"}
            </span>
          </p>
          <div className="flex-1" />
          <div className="flex items-center gap-3.5 rounded-xl border border-border bg-card p-4">
            <Photo src={student.photoUrl} alt="Your photo" className="size-14 rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="text-base font-extrabold">
                {student.firstName} {student.lastName}
              </div>
              <div className="font-mono text-[13px] text-muted-foreground">
                {[armName, student.admissionNo].filter(Boolean).join(" · ")}
              </div>
            </div>
            <span className="text-[13px] text-ink-2">Not you? Tell the invigilator.</span>
          </div>
        </section>
        <section className="flex flex-col gap-[22px] p-16">
          <div className="rounded-xl border border-border bg-card p-7 text-center">
            <LobbyCountdown
              {...live}
              labelClassName="text-[13px] font-bold tracking-[.08em] text-muted-foreground uppercase"
              digitsClassName="text-[64px] leading-tight"
            />
          </div>
          <Rules rules={rules} size="lab" />
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            <p className="flex-1 text-sm text-ink-2">
              Keyboard: <b>A–D</b> answer · <b>N</b> next · <b>P</b> previous · <b>F</b> flag
            </p>
            <StartExamButton {...live} waitingLabel={`Start at ${startTime}`} />
          </div>
        </section>
      </div>
    </main>
  );
}
