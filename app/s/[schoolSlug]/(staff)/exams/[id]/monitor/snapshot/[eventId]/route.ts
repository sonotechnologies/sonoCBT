import { and, eq } from "drizzle-orm";
import { attempt, integrityEvent, student } from "@/lib/db/schema";
import { monitorAccess, MonitorError } from "@/lib/exams/monitor";
import { readPrivate } from "@/lib/storage";
import { getTenantContext } from "@/lib/tenant/context";

/** Staff-only view of an identity photo. Never cached, never public. */
export async function GET(_: Request, ctx: RouteContext<"/s/[schoolSlug]/exams/[id]/monitor/snapshot/[eventId]">) {
  const { schoolSlug, id, eventId } = await ctx.params;
  const t = await getTenantContext(schoolSlug);
  if (!t || !t.isStaff) return new Response("Signed out", { status: 401 });
  let armIds: string[] | null;
  try {
    ({ armIds } = await monitorAccess(t.scope, t.actor, id));
  } catch (e) {
    if (e instanceof MonitorError) return new Response("Not found", { status: 404 });
    throw e;
  }
  const ev = await t.scope.findFirst(integrityEvent, and(eq(integrityEvent.id, eventId), eq(integrityEvent.type, "snapshot")));
  const a = ev ? await t.scope.findFirst(attempt, and(eq(attempt.id, ev.attemptId), eq(attempt.examId, id))) : undefined;
  const s = a ? await t.scope.findFirst(student, eq(student.id, a.studentId)) : undefined;
  if (!ev || !a || !s || (armIds && !armIds.includes(s.classArmId ?? ""))) return new Response("Not found", { status: 404 });
  const body = await readPrivate(String(ev.meta?.key ?? ""));
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
