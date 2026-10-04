import { cookies } from "next/headers";
import { getBilling } from "@/lib/billing/context";
import { hasFeature } from "@/lib/billing/state";
import { getDb } from "@/lib/db";
import { attachment, cardFileName, reportCardsPdf } from "@/lib/pdf/report-cards";
import { getReportCard } from "@/lib/results/report-card";
import { readResultToken, RESULT_COOKIE } from "@/lib/results/token";
import { tenantScope } from "@/lib/tenant/scope";

/** The parent's PDF of the report card their PIN opened (same 30-minute grant as the page). */
export async function GET() {
  const grant = readResultToken((await cookies()).get(RESULT_COOKIE)?.value);
  if (!grant) return new Response("Check the result again with your PIN.", { status: 401 });
  if (!hasFeature(await getBilling(grant.schoolId), "report_cards")) return new Response("The school's plan doesn't include PDF report cards.", { status: 403 });
  const res = await getReportCard(tenantScope(getDb(), grant.schoolId), grant.studentId, grant.termId);
  if (res.status !== "released") return new Response("Not yet released.", { status: 404 });
  const pdf = await reportCardsPdf([res.card], `${res.card.student.name} · ${res.card.termLabel}`);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": attachment(cardFileName(res.card)),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
