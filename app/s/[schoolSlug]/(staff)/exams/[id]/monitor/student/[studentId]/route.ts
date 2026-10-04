import { MonitorError, studentTimeline } from "@/lib/exams/monitor";
import { getTenantContext } from "@/lib/tenant/context";

/** One student's timeline for the monitor's side panel. */
export async function GET(_: Request, ctx: RouteContext<"/s/[schoolSlug]/exams/[id]/monitor/student/[studentId]">) {
  const { schoolSlug, id, studentId } = await ctx.params;
  const t = await getTenantContext(schoolSlug);
  if (!t || !t.isStaff) return Response.json({ error: "Signed out." }, { status: 401 });
  try {
    return Response.json(await studentTimeline(t.scope, t.actor, id, studentId), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof MonitorError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
