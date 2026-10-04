import type { Metadata } from "next";
import { getBilling } from "@/lib/billing/context";
import { hasFeature } from "@/lib/billing/state";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Photo } from "@/components/ui/photo";
import { getDb } from "@/lib/db";
import { num } from "@/lib/format";
import { ordinal } from "@/lib/grading";
import { getReportCard } from "@/lib/results/report-card";
import { readResultToken, RESULT_COOKIE } from "@/lib/results/token";
import { tenantScope } from "@/lib/tenant/scope";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Report card", robots: { index: false } };

export default async function ReportCardViewPage() {
  const grant = readResultToken((await cookies()).get(RESULT_COOKIE)?.value);
  if (!grant) redirect("/results");

  const res = await getReportCard(tenantScope(getDb(), grant.schoolId), grant.studentId, grant.termId);
  if (res.status !== "released") {
    return (
      <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <h1 className="text-xl font-extrabold">Not yet released</h1>
        <p className="max-w-sm text-[15px] text-ink-2">Results for {res.termLabel} are not available yet.</p>
        <Link href="/results" className="font-semibold underline">
          Check another result
        </Link>
      </main>
    );
  }

  const c = res.card;
  const pdfOk = hasFeature(await getBilling(grant.schoolId), "report_cards");
  const summary = [
    { k: "Average", v: num(c.average) },
    { k: "Position", v: ordinal(c.position) },
    { k: "Out of", v: String(c.numberInClass) },
  ];

  return (
    <main className="flex h-dvh flex-1 flex-col bg-background print:h-auto">
      <header className="flex-none border-b border-border bg-card">
        <div className="mx-auto flex max-w-[560px] items-center gap-3 px-5 py-[18px]">
          <Photo src={c.student.photoUrl} alt={`${c.student.name}'s photo`} className="h-14 w-12 rounded-[6px]" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-extrabold">{c.student.name}</h1>
            <p className="text-xs text-muted-foreground">
              {c.classArmName} · {c.termLabel}
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto print:overflow-visible">
        <div className="mx-auto flex max-w-[560px] flex-col gap-3 p-4">
          <dl className="grid grid-cols-3 gap-2">
            {summary.map((s) => (
              <div key={s.k} className="rounded-lg border border-border bg-card p-3">
                <dt className="text-[11px] text-muted-foreground">{s.k}</dt>
                <dd className="font-mono text-xl font-semibold">{s.v}</dd>
              </div>
            ))}
          </dl>

          <ul className="rounded-xl border border-border bg-card" aria-label="Subjects">
            {c.subjects.map((s) => (
              <li key={s.name} className="flex items-center gap-2.5 border-b border-divider px-3.5 py-2.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">{s.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {[...s.components.map((x) => `${x.name} ${num(x.value)}`), `Class avg ${num(s.classAverage)}`].join(" · ")}
                  </div>
                </div>
                <div className="font-mono text-base font-semibold" aria-label={`Total ${num(s.total)}`}>
                  {num(s.total)}
                </div>
                <span
                  className="w-9 rounded-[6px] bg-chip py-[3px] text-center font-mono text-[13px] font-bold"
                  aria-label={`Grade ${s.grade}`}
                >
                  {s.grade}
                </span>
              </li>
            ))}
          </ul>

          {(c.formTeacherRemark || c.principalRemark) && (
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5 text-[13px] leading-normal">
              {c.formTeacherRemark && (
                <p>
                  <b>Form teacher:</b> {c.formTeacherRemark}
                </p>
              )}
              {c.principalRemark && (
                <p>
                  <b>Principal:</b> {c.principalRemark}
                </p>
              )}
            </div>
          )}
          {c.daysOpened !== null && c.daysPresent !== null && (
            <p className="text-[13px] text-muted-foreground">
              Present {c.daysPresent} of {c.daysOpened} days{c.nextResumesOn ? ` · next term begins ${c.nextResumesOn.split("-").reverse().join("/")}` : ""}
            </p>
          )}
        </div>
      </div>

      <footer className="flex-none border-t border-border bg-card print:hidden">
        <div className="mx-auto max-w-[560px] px-4 pt-3 pb-4">
          {pdfOk && (
          <a href="/results/view/pdf" className={cn(buttonVariants({ variant: "primary" }), "h-[52px] w-full text-[15px]")}>
            Download PDF report card
          </a>
          )}
          {c.verifyCode && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Verification code <span className="font-mono font-semibold text-foreground">{c.verifyCode}</span> ·{" "}
              <Link href={`/verify/${c.verifyCode}`} className="underline">
                check it
              </Link>
            </p>
          )}
        </div>
      </footer>
    </main>
  );
}
