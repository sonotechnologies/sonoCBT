import type { Metadata } from "next";
import { Locked } from "@/components/billing/locked";
import { getBilling } from "@/lib/billing/context";
import { hasFeature } from "@/lib/billing/state";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExtrasEditor } from "@/components/report-cards/extras-editor";
import { getCurrentTerm, listTerms } from "@/lib/data/terms";
import { classExtras } from "@/lib/results/extras";
import { ResultsError } from "@/lib/results/pipeline";
import { requireStaff } from "@/lib/tenant/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Report cards" };

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-chip text-ink-2" },
  under_review: { label: "In review", cls: "bg-[#EAF1F9] text-[#1D4B80]" },
  approved: { label: "Approved", cls: "bg-[#E8F4EC] text-[#155E34]" },
  released: { label: "Released", cls: "bg-[#E8F4EC] text-[#155E34]" },
};

export default async function ClassReportCardsPage({ params, searchParams }: PageProps<"/s/[schoolSlug]/report-cards/[armId]">) {
  const { schoolSlug, armId } = await params;
  const sp = await searchParams;
  const ctx = await requireStaff(schoolSlug);
  const billing = await getBilling(ctx.school.id);
  if (!hasFeature(billing, "report_cards")) {
    return (
      <main className="min-w-0 flex-1 px-4 lg:px-10">
        <Locked feature="report_cards" billing={billing} slug={schoolSlug} canManage={ctx.actor.roles.some((r) => r.role === "school_admin")} />
      </main>
    );
  }
  const terms = await listTerms(ctx.scope);
  const term = terms.find((t) => t.id === sp.term) ?? (await getCurrentTerm(ctx.scope));
  if (!term) notFound();
  let data: Awaited<ReturnType<typeof classExtras>> | null = null;
  try {
    data = await classExtras(ctx.scope, ctx.actor, term.id, armId);
  } catch (e) {
    if (!(e instanceof ResultsError)) throw e;
  }
  if (!data) notFound();
  const pdf = `/s/${schoolSlug}/report-cards/${armId}/pdf?term=${term.id}`;
  const released = data.access.status === "released";
  const hasScores = data.students.some((s) => s.average !== null);

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col lg:max-h-[calc(100dvh-3.5rem)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-[18px] lg:px-8">
        <div className="min-w-[220px] flex-1">
          <div className="text-[13px] font-semibold text-muted-foreground">
            <Link href={`/s/${schoolSlug}/report-cards?term=${term.id}`} className="text-muted-foreground">
              Report cards
            </Link>{" "}
            · {term.label}
          </div>
          <h1 className="mt-0.5 text-[22px] font-extrabold">{data.arm.name}</h1>
        </div>
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", STATUS[data.access.status].cls)}>{STATUS[data.access.status].label}</span>
        {hasScores && (
          <>
            <a href={pdf} className="h-10 rounded-md bg-ink px-4 text-[13px] leading-10 font-bold text-white no-underline">
              {released ? "Download class PDF" : "Preview class PDF"}
            </a>
            <a href={`${pdf}&format=zip`} className="h-10 rounded-md border-[1.5px] border-input bg-card px-4 text-[13px] leading-[37px] font-bold text-foreground no-underline">
              One PDF per student (.zip)
            </a>
          </>
        )}
      </div>
      {!released && hasScores && (
        <p className="border-b border-border bg-[#FDF1E6] px-4 py-2.5 text-sm text-[#7A3B0A] lg:px-8">
          Not released yet: PDFs are marked &ldquo;Preview&rdquo; and have no verification code until the admin releases this class.
        </p>
      )}
      <ExtrasEditor
        key={term.id}
        slug={schoolSlug}
        termId={term.id}
        classArmId={armId}
        students={data.students}
        canEdit={data.access.edit}
        canPrincipal={data.access.principal}
        pdfBase={pdf}
      />
    </main>
  );
}
