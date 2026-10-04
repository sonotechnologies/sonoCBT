import { attachment, cardFileName, reportCardsPdf } from "@/lib/pdf/report-cards";
import { getBilling } from "@/lib/billing/context";
import { hasFeature } from "@/lib/billing/state";
import { getReportCard } from "@/lib/results/report-card";
import { getTenantContext } from "@/lib/tenant/context";

/** A student's own released report card as a PDF. */
export async function GET(_: Request, ctx: RouteContext<"/s/[schoolSlug]/student/report-card/[termId]">) {
  const { schoolSlug, termId } = await ctx.params;
  const t = await getTenantContext(schoolSlug);
  if (!t?.student) return new Response("Signed out", { status: 401 });
  if (!hasFeature(await getBilling(t.school.id), "report_cards")) return new Response("PDF report cards aren't on this school's plan.", { status: 403 });
  const res = await getReportCard(t.scope, t.student.id, termId);
  if (res.status !== "released") return new Response("Not yet released.", { status: 404 });
  const pdf = await reportCardsPdf([res.card], `${res.card.student.name} · ${res.card.termLabel}`);
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": attachment(cardFileName(res.card)), "Cache-Control": "private, no-store" },
  });
}
