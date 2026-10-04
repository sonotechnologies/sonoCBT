import { monitorData, MonitorError } from "@/lib/exams/monitor";
import { getTenantContext } from "@/lib/tenant/context";

/** The live monitor polls this every 10 seconds. */
export async function GET(_: Request, ctx: RouteContext<"/s/[schoolSlug]/exams/[id]/monitor/data">) {
  const { schoolSlug, id } = await ctx.params;
  const t = await getTenantContext(schoolSlug);
  if (!t || !t.isStaff) return Response.json({ error: "Signed out." }, { status: 401 });
  try {
    return Response.json(await monitorData(t.scope, t.actor, id), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof MonitorError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
