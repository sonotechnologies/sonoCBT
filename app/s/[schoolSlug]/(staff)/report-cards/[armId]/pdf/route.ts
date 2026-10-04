import { extrasAccess } from "@/lib/results/extras";
import { getBilling } from "@/lib/billing/context";
import { hasFeature } from "@/lib/billing/state";
import { ResultsError } from "@/lib/results/pipeline";
import { buildReportCards } from "@/lib/results/report-card";
import { attachment, cardFileName, reportCardsPdf, reportCardsZip } from "@/lib/pdf/report-cards";
import { getTenantContext } from "@/lib/tenant/context";

/**
 * Staff download: ?term=…[&student=…][&format=zip]. One student, the whole
 * class as one PDF, or a zip of single PDFs. Before release it's a preview,
 * watermarked and without a verify code.
 */
export async function GET(req: Request, ctx: RouteContext<"/s/[schoolSlug]/report-cards/[armId]/pdf">) {
  const { schoolSlug, armId } = await ctx.params;
  const t = await getTenantContext(schoolSlug);
  if (!t || !t.isStaff) return new Response("Signed out", { status: 401 });
  if (!hasFeature(await getBilling(t.school.id), "report_cards")) return new Response("PDF report cards aren't on this school's plan.", { status: 403 });
  const url = new URL(req.url);
  const termId = url.searchParams.get("term") ?? "";
  const studentId = url.searchParams.get("student");
  try {
    if (!(await extrasAccess(t.scope, t.actor, termId, armId)).view) return new Response("Not found", { status: 404 });
  } catch (e) {
    if (e instanceof ResultsError) return new Response("Not found", { status: 404 });
    throw e;
  }
  const built = await buildReportCards(t.scope, termId, armId, { allowUnreleased: true, studentIds: studentId ? [studentId] : undefined });
  if (!built.cards.length) return new Response("No results for this class yet.", { status: 404 });
  const armName = built.cards[0].classArmName;
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (url.searchParams.get("format") === "zip" && !studentId) {
    const zip = await reportCardsZip(built.cards, built.termLabel);
    return new Response(new Uint8Array(zip), {
      headers: { ...headers, "Content-Type": "application/zip", "Content-Disposition": attachment(`${armName} report cards ${built.termLabel}.zip`) },
    });
  }
  const pdf = await reportCardsPdf(built.cards, `${studentId ? built.cards[0].student.name : armName} · ${built.termLabel}`);
  const name = studentId ? cardFileName(built.cards[0]) : `${armName} report cards ${built.termLabel}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": attachment(name, url.searchParams.get("inline") === "1") },
  });
}
