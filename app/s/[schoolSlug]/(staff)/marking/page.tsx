import type { Metadata } from "next";
import Link from "next/link";
import { inArray } from "drizzle-orm";
import { PushScoresButton } from "@/components/marking/push-scores";
import { can } from "@/lib/auth/permissions";
import { assessmentComponent, exam } from "@/lib/db/schema";
import { formatDate, formatTime } from "@/lib/format";
import { markingQueue } from "@/lib/marking/service";
import { requireStaff } from "@/lib/tenant/context";

export const metadata: Metadata = { title: "Marking" };

export default async function MarkingPage({ params }: PageProps<"/s/[schoolSlug]/marking">) {
  const { schoolSlug } = await params;
  const ctx = await requireStaff(schoolSlug);
  const queue = await markingQueue(ctx.scope, ctx.actor);
  const examIds = [...new Set(queue.map((q) => q.examId))];
  const exams = examIds.length ? await ctx.scope.findMany(exam, inArray(exam.id, examIds)) : [];
  const comps = await ctx.scope.findMany(assessmentComponent);
  const canPush = can(ctx.actor, "marks.moderate", { schoolId: ctx.school.id }) || can(ctx.actor, "exam.manage", { schoolId: ctx.school.id });
  const left = queue.reduce((a, q) => a + q.total - q.marked, 0);

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="border-b border-border bg-card px-4 py-5 lg:px-8">
        <div className="text-[13px] font-semibold text-muted-foreground">Marking</div>
        <h1 className="mt-0.5 text-2xl font-extrabold">{left ? `${left} theory ${left === 1 ? "answer" : "answers"} to mark` : "Nothing waiting to be marked"}</h1>
        <p className="mt-1 text-sm text-ink-2">Objective questions are marked by SonoCBT the moment students submit. Theory answers wait here, one question at a time, with names hidden.</p>
      </div>
      <div className="flex flex-col gap-5 p-4 lg:p-8">
        {examIds.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">When students submit an exam with theory questions in your subjects, they appear here.</p>}
        {examIds.map((id) => {
          const e = exams.find((x) => x.id === id)!;
          const qs = queue.filter((q) => q.examId === id);
          const comp = comps.find((c) => c.id === e.componentId);
          const unmarked = qs.reduce((a, q) => a + q.total - q.marked, 0);
          return (
            <section key={id} className="rounded-xl border border-border bg-card" aria-label={e.title}>
              <div className="flex flex-wrap items-center gap-3 border-b border-divider px-5 py-4">
                <div className="min-w-[200px] flex-1">
                  <h2 className="text-base font-extrabold">{e.title}</h2>
                  <div className="text-[13px] text-muted-foreground">
                    {formatDate(e.windowStart)} · counts towards {comp ? `${comp.name} /${comp.weight}` : "nothing yet (set it in the exam's Details)"}
                    {e.scoresPushedAt ? ` · last sent to the grid ${formatDate(e.scoresPushedAt)} ${formatTime(e.scoresPushedAt)}` : ""}
                  </div>
                </div>
                {canPush && <PushScoresButton slug={schoolSlug} examId={id} disabledReason={unmarked ? `${unmarked} still to mark` : !comp ? "Choose what it counts towards" : null} />}
              </div>
              <ul className="divide-y divide-divider">
                {qs.map((q) => (
                  <li key={q.examQuestionId} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                    <span className="font-mono text-xs text-muted-foreground">{q.code}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{q.text}</span>
                    <span className="font-mono text-[13px]">
                      {q.marked}/{q.total}
                    </span>
                    <span className="h-1.5 w-28 overflow-hidden rounded-[3px] bg-border">
                      <span className="block h-full bg-success" style={{ width: `${Math.round((q.marked / q.total) * 100)}%` }} />
                    </span>
                    <Link href={`/s/${schoolSlug}/marking/${q.examQuestionId}`} className="h-9 rounded-md bg-ink px-4 text-[13px] leading-9 font-bold text-white no-underline">
                      {q.marked === q.total ? "Review" : "Mark"}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}
