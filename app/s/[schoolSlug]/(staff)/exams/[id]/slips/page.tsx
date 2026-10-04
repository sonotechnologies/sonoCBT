import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { ExamError, examSlips } from "@/lib/exams/builder";
import { formatDate, formatTime } from "@/lib/format";
import { requireStaff } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Exam slips" };

/** Exam slips (10 to an A4 page) and the invigilator's PIN sheet, per class: an on-screen preview with A4 PDF downloads. */
export default async function SlipsPage({ params, searchParams }: PageProps<"/s/[schoolSlug]/exams/[id]/slips">) {
  const { schoolSlug, id } = await params;
  const sp = await searchParams;
  const ctx = await requireStaff(schoolSlug);
  let data: Awaited<ReturnType<typeof examSlips>>;
  try {
    data = await examSlips(ctx.scope, ctx.actor, id);
  } catch (e) {
    if (e instanceof ExamError) notFound();
    throw e;
  }
  const { exam, classes } = data;
  const view = sp.view === "pins" ? "pins" : "slips";
  const cls = classes.find((c) => c.classArmId === sp.class) ?? classes[0];
  const when = `${formatDate(exam.windowStart)} · ${formatTime(exam.windowStart)}`;
  const host = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/^https?:\/\//, "") || "sonocbt";
  const pages = cls ? Array.from({ length: Math.ceil(cls.slips.length / 10) }, (_, i) => cls.slips.slice(i * 10, i * 10 + 10)) : [];

  return (
    <main className="flex min-w-0 flex-1 flex-col print:block">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-5 lg:px-8 print:hidden">
        <div className="min-w-[200px] flex-1">
          <div className="text-[13px] font-semibold text-muted-foreground">
            <Link href={`/s/${schoolSlug}/exams/${id}?step=preview`} className="text-muted-foreground">
              {exam.title}
            </Link>{" "}
            · {view === "pins" ? "PIN sheet" : "Exam slips"}
          </div>
          <h1 className="mt-0.5 text-xl font-extrabold">
            {view === "pins" ? "PIN sheet" : "Exam slips"} · {cls?.name ?? "—"} · {cls?.slips.length ?? 0} students
          </h1>
        </div>
        {exam.pinRequired && (
          <Link href={`?view=${view === "pins" ? "slips" : "pins"}${cls ? `&class=${cls.classArmId}` : ""}`} className={cn(buttonVariants({ variant: "outline", size: "md" }))}>
            {view === "pins" ? "Student slips" : "PIN sheet (invigilator)"}
          </Link>
        )}
        {cls && (
          <a href={`/s/${schoolSlug}/exams/${id}/slips/pdf?view=${view}&class=${cls.classArmId}`} className={cn(buttonVariants({ size: "md" }), "no-underline")}>
            {view === "pins" ? "PIN sheet PDF" : "Slips PDF · 10 per A4 page"}
          </a>
        )}
        {classes.length > 1 && (
          <a href={`/s/${schoolSlug}/exams/${id}/slips/pdf?view=${view}&class=all`} className={cn(buttonVariants({ variant: "outline", size: "md" }), "no-underline")}>
            All classes (PDF)
          </a>
        )}
      </div>
      {classes.length > 1 && (
        <nav aria-label="Class" className="flex flex-wrap gap-2 border-b border-border bg-background px-4 py-3 lg:px-8 print:hidden">
          {classes.map((c) => (
            <Link key={c.classArmId} href={`?view=${view}&class=${c.classArmId}`} aria-current={c.classArmId === cls?.classArmId ? "page" : undefined} className={cn("h-[34px] rounded-md border px-3 text-[13px] leading-[32px] font-semibold no-underline", c.classArmId === cls?.classArmId ? "border-ink bg-ink text-white" : "border-border bg-card text-foreground")}>
              {c.name} · {c.slips.length}
            </Link>
          ))}
        </nav>
      )}
      {!exam.pinRequired && (
        <p className="border-b border-border bg-background px-4 py-2.5 text-sm text-ink-2 lg:px-8 print:hidden">This exam doesn&apos;t use PINs, so slips show the seat and sign-in details only.</p>
      )}

      <div className="overflow-auto bg-canvas p-4 lg:p-8 print:bg-white print:p-0">
        {view === "pins" ? (
          <section className="mx-auto w-[794px] max-w-full bg-white p-10 text-black shadow-[0_4px_12px_rgba(20,33,61,.08)] print:w-auto print:shadow-none">
            <h2 className="text-lg font-extrabold">
              {ctx.school.name} · {exam.title}
            </h2>
            <p className="text-sm">
              {cls?.name} · {cls?.venue ?? exam.venue ?? ""} · {when}. Keep this sheet with the invigilator.
            </p>
            <table className="mt-4 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-black text-left">
                  <th className="py-1.5 pr-2">Seat</th>
                  <th className="py-1.5 pr-2">Student</th>
                  <th className="py-1.5 pr-2">Admission no.</th>
                  <th className="py-1.5 pr-2">PIN</th>
                  <th className="py-1.5">Signed</th>
                </tr>
              </thead>
              <tbody>
                {cls?.slips.map((s) => (
                  <tr key={s.studentId} className="border-b border-[#bbb]">
                    <td className="py-1.5 pr-2 font-mono">{s.seat}</td>
                    <td className="py-1.5 pr-2">{s.name}</td>
                    <td className="py-1.5 pr-2 font-mono">{s.admissionNo}</td>
                    <td className="py-1.5 pr-2 font-mono font-bold tracking-[.06em]">{s.pin ?? "—"}</td>
                    <td className="w-32 py-1.5" />
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : (
          pages.map((page, pi) => (
            <section key={pi} className="mx-auto mb-6 grid w-[794px] max-w-full grid-cols-2 bg-white p-7 shadow-[0_4px_12px_rgba(20,33,61,.08)] print:mb-0 print:w-auto print:break-after-page print:shadow-none">
              {page.map((s) => (
                <div key={s.studentId} className="-m-px flex min-h-[190px] flex-col gap-1.5 border border-dashed border-[#9AA1B0] px-4 py-3.5 text-black">
                  <div className="flex justify-between gap-2 text-[10px] font-bold tracking-[.04em] uppercase">
                    <span className="truncate">
                      {ctx.school.name} · {exam.title}
                    </span>
                    <span className="whitespace-nowrap">{when}</span>
                  </div>
                  <div className="flex items-end justify-between gap-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-extrabold">{s.name}</div>
                      <div className="font-mono text-[11px]">
                        {s.admissionNo} · {s.className} · Seat {s.seat ?? "—"}
                      </div>
                      {s.venue && <div className="text-[11px]">{s.venue}</div>}
                    </div>
                    {s.pin && (
                      <div className="text-right">
                        <div className="text-[9px] font-bold">EXAM PIN</div>
                        <div className="font-mono text-xl font-bold tracking-[.06em]">{s.pin}</div>
                      </div>
                    )}
                  </div>
                  <div className="mt-auto text-[9px]">
                    Sign in at <b>{host}/s/{schoolSlug}/login</b> with your admission number. Keep this slip private.
                  </div>
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </main>
  );
}
