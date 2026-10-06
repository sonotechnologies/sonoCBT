import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { listExams, TYPE_LABEL } from "@/lib/exams/builder";
import { formatDate, formatDuration, formatTime } from "@/lib/format";
import { requireStaff } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Exams" };

const PHASE: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-chip text-ink-2" },
  scheduled: { label: "Scheduled", cls: "bg-[#EAF1F9] text-[#1D4B80]" },
  live: { label: "Live now", cls: "bg-[#E8F4EC] text-[#155E34]" },
  closed: { label: "Closed", cls: "bg-secondary text-muted-foreground" },
};

export default async function ExamsPage({ params, searchParams }: PageProps<"/s/[schoolSlug]/exams">) {
  const { schoolSlug } = await params;
  const { show } = await searchParams;
  const ctx = await requireStaff(schoolSlug);
  const all = await listExams(ctx.scope, ctx.actor);
  const filter = typeof show === "string" && ["draft", "scheduled", "live", "closed"].includes(show) ? show : "";
  const rows = filter ? all.filter((e) => e.phase === filter) : all.filter((e) => e.phase !== "closed");
  const counts = Object.fromEntries(["draft", "scheduled", "live", "closed"].map((p) => [p, all.filter((e) => e.phase === p).length]));

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-5 lg:px-8">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-muted-foreground">Exams</div>
          <h1 className="mt-0.5 text-2xl font-extrabold">{filter ? PHASE[filter].label : "Current and upcoming"}</h1>
        </div>
        <Link href={`/s/${schoolSlug}/exams/new`} className={cn(buttonVariants({ size: "md" }))}>
          New exam
        </Link>
      </div>
      <nav aria-label="Filter" className="chip-row flex flex-wrap gap-2 border-b border-border bg-background px-4 py-3 lg:px-8">
        {[["", "Current & upcoming"], ...Object.entries(PHASE).map(([k, v]) => [k, `${v.label} ${counts[k]}`])].map(([k, l]) => (
          <Link key={k} href={k ? `?show=${k}` : "?"} aria-current={filter === k ? "page" : undefined} className={cn("flex h-10 items-center rounded-md border px-3 text-[13px] font-semibold whitespace-nowrap no-underline sm:h-[34px]", filter === k ? "border-ink bg-ink text-white" : "border-border bg-card text-foreground")}>
            {l}
          </Link>
        ))}
      </nav>
      <div className="p-4 lg:px-8">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-base font-bold">{filter ? "Nothing here" : "No exams yet"}</p>
            <p className="max-w-sm text-sm text-ink-2">Build an exam from your approved questions, choose the classes and time, then publish. Students see it on their home screen.</p>
            <Link href={`/s/${schoolSlug}/exams/new`} className={cn(buttonVariants({ size: "md" }))}>
              New exam
            </Link>
          </div>
        ) : (
          <div className="relative overflow-x-auto rounded-xl border border-border bg-card">
            <table className="stack-table w-full min-w-[720px] text-sm">
              <thead className="border-b border-border text-left text-xs font-bold tracking-[.06em] text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-3">Exam</th>
                  <th className="px-4 py-3">Classes</th>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3 text-right">Students</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {rows.map((e) => (
                  <tr key={e.id} className="relative hover:bg-background">
                    <td className="px-4 py-3">
                      <Link href={`/s/${schoolSlug}/exams/${e.id}`} className="font-bold after:absolute after:inset-0 sm:after:hidden">
                        {e.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {TYPE_LABEL[e.type]} · {e.subjects.join(", ")} · {formatDuration(e.durationMinutes)}
                        {e.totalMarks ? ` · ${e.totalMarks} marks` : ""}
                      </div>
                    </td>
                    <td data-label="Classes" className="px-4 py-3">{e.classes.join(", ")}</td>
                    <td data-label="Starts" className="px-4 py-3 font-mono text-[13px] whitespace-nowrap">
                      {formatDate(e.windowStart)} · {formatTime(e.windowStart)}
                    </td>
                    <td data-label="Students" className="px-4 py-3 text-right font-mono">{e.status === "draft" ? "—" : e.candidates}</td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded-full px-2 py-[3px] text-xs font-semibold", PHASE[e.phase].cls)}>{PHASE[e.phase].label}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
