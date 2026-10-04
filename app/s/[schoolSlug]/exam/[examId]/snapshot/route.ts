import { saveSnapshot } from "@/lib/exams/runtime";
import { getTenantContext } from "@/lib/tenant/context";

/** The exam page posts an identity photo here (raw JPEG body, ?attempt=<id>). */
export async function POST(req: Request, ctx: RouteContext<"/s/[schoolSlug]/exam/[examId]/snapshot">) {
  const { schoolSlug } = await ctx.params;
  const t = await getTenantContext(schoolSlug);
  if (!t || !t.student) return Response.json({ ok: false }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > 200_000) return Response.json({ ok: false }, { status: 413 });
  const attemptId = new URL(req.url).searchParams.get("attempt") ?? "";
  const body = new Uint8Array(await req.arrayBuffer());
  const res = await saveSnapshot(t.scope, t.student.id, attemptId, body);
  return Response.json(res, { status: res.ok ? 200 : 400 });
}
