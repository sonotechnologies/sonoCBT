import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { school } from "@/lib/db/schema";
import { seedDemoSchool } from "@/scripts/demo/seed-demo";
import { DEMO_SLUG } from "./config";

/**
 * Rebuilds the demo school from scratch: everything visitors did is gone
 * (its users, sessions, answers and logs go with the school). One
 * transaction, so nobody ever sees it half-built. Other schools are untouched.
 */
export async function resetDemoSchool(db: Db, now = new Date()) {
  const started = Date.now();
  const result = await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [taken] = await t.select({ isDemo: school.isDemo }).from(school).where(eq(school.slug, DEMO_SLUG));
    if (taken && !taken.isDemo) throw new Error(`A real school uses the slug "${DEMO_SLUG}"; not touching it.`);
    await t.delete(school).where(and(eq(school.slug, DEMO_SLUG), eq(school.isDemo, true)));
    return seedDemoSchool(t, now);
  });
  return { ...result, seconds: Math.round((Date.now() - started) / 100) / 10 };
}
