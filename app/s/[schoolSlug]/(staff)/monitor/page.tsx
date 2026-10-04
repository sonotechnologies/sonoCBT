import type { Metadata } from "next";
import Link from "next/link";
import { monitorableExams } from "@/lib/exams/monitor";
import { formatDate, formatTime } from "@/lib/format";
import { requireStaff } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Live monitor" };

/** Exams running now or today that this person may watch (invigilators: their own rooms). */
export default async function MonitorListPage({ params }: PageProps<"/s/[schoolSlug]/monitor">) {
  const { schoolSlug } = await params;
  const ctx = await requireStaff(schoolSlug);
  const exams = await monitorableExams(ctx.scope, ctx.actor);
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="border-b border-border bg-card px-4 py-5 lg:px-8">
        <div className="text-[13px] font-semibold text-muted-foreground">Live monitor</div>
        <h1 className="mt-0.5 text-2xl font-extrabold">Exams today</h1>
      </div>
      <div className="flex flex-col gap-3 p-4 lg:p-8">
        {exams.length === 0 ? (
          <p className="py-12 text-center text-sm text-ink-2">No exams are running or due in the next day{ctx.actor.roles.some((r) => r.role === "teacher") ? " that you're invigilating" : ""}.</p>
        ) : (
          exams.map((e) => (
            <Link key={e.id} href={`/s/${schoolSlug}/exams/${e.id}/monitor`} className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-5 py-4 text-foreground no-underline hover:border-ink">
              <span className={cn("flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-xs font-extrabold", e.phase === "live" ? "bg-pencil text-ink" : "bg-chip text-ink-2")}>
                {e.phase === "live" && <span className="size-[7px] rounded-full bg-ink" />}
                {e.phase === "live" ? "LIVE" : e.phase === "closed" ? "CLOSED" : "LATER"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-bold">{e.title}</span>
                <span className="text-[13px] text-muted-foreground">
                  {formatDate(e.windowStart)} · {formatTime(e.windowStart)}–{formatTime(e.windowEnd)}
                  {e.venue ? ` · ${e.venue}` : ""}
                  {e.scoped ? " · your room" : ""}
                </span>
              </span>
              <span className="text-sm font-semibold">Open monitor →</span>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
