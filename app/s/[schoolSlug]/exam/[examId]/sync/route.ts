import { clientIp } from "@/lib/exams/integrity";
import { syncAttempt } from "@/lib/exams/runtime";
import type { SyncRequest, SyncResponse } from "@/lib/exams/runtime-types";
import { getTenantContext } from "@/lib/tenant/context";

/**
 * The exam runtime's whole server API: save answers (and heartbeat), or submit.
 * Small JSON in, small JSON out, so it works on a weak connection and could
 * later be served by a school's own LAN box.
 */
export async function POST(req: Request, ctx: RouteContext<"/s/[schoolSlug]/exam/[examId]/sync">) {
  const { schoolSlug } = await ctx.params;
  const noStore = { "Cache-Control": "no-store" };
  const t = await getTenantContext(schoolSlug);
  if (!t || !t.student) return Response.json({ ok: false, error: "Signed out." } satisfies SyncResponse, { status: 401, headers: noStore });

  if (Number(req.headers.get("content-length") ?? 0) > 1_000_000) {
    return Response.json({ ok: false, error: "Too much at once." } satisfies SyncResponse, { status: 413, headers: noStore });
  }
  let body: SyncRequest;
  try {
    body = (await req.json()) as SyncRequest;
  } catch {
    return Response.json({ ok: false, error: "Bad request." } satisfies SyncResponse, { status: 400, headers: noStore });
  }
  if (!body || typeof body.attemptId !== "string") {
    return Response.json({ ok: false, error: "Bad request." } satisfies SyncResponse, { status: 400, headers: noStore });
  }
  const res = await syncAttempt(t.scope, t.student.id, body, new Date(), clientIp(req.headers));
  return Response.json(res, { status: res.ok ? 200 : res.blocked ? 409 : 404, headers: noStore });
}
