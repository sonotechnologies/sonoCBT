import { getDb } from "@/lib/db";
import { resetDemoSchool } from "@/lib/demo/reset";

// Rebuilding takes a few seconds on Neon; allow plenty.
export const maxDuration = 300;

/**
 * Nightly demo reset (vercel.json runs it at 00:00 UTC, 01:00 in Lagos).
 * Vercel sends "Authorization: Bearer $CRON_SECRET"; anything else is refused.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET isn't set.", { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const r = await resetDemoSchool(getDb());
  return Response.json({ ok: true, seconds: r.seconds });
}
