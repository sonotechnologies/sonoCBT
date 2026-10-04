import { analyticsAccess, AnalyticsError } from "@/lib/analytics/access";
import { getBilling } from "@/lib/billing/context";
import { hasFeature } from "@/lib/billing/state";
import { buildTable, TABLES, toCsv, type TableKey } from "@/lib/analytics/csv";
import { attachment } from "@/lib/pdf/report-cards";
import { getTenantContext } from "@/lib/tenant/context";

/** Any analytics table as CSV: ?table=exam-questions&exam=… (see TABLES). */
export async function GET(req: Request, ctx: RouteContext<"/s/[schoolSlug]/analytics/export">) {
  const { schoolSlug } = await ctx.params;
  const t = await getTenantContext(schoolSlug);
  if (!t || !t.isStaff) return new Response("Signed out", { status: 401 });
  if (!hasFeature(await getBilling(t.school.id), "analytics")) return new Response("Analytics aren't on this school's plan.", { status: 403 });
  const access = await analyticsAccess(t.scope, t.actor);
  if (!access) return new Response("Not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  const key = q.get("table") as TableKey;
  if (!TABLES.includes(key)) return new Response("Unknown table", { status: 400 });
  try {
    const table = await buildTable(t.scope, access, key, { exam: q.get("exam") ?? undefined, term: q.get("term") ?? undefined, subject: q.get("subject") ?? undefined });
    return new Response(toCsv(table), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": attachment(`${table.name}.csv`), "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof AnalyticsError) return new Response(e.message, { status: 404 });
    throw e;
  }
}
