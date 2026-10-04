/**
 * Deletes exam identity photos older than 30 days (the promise made to
 * students on the consent screen). Run daily, e.g. from a cron job:
 *   npm run snapshots:purge
 */
import { config } from "dotenv";
import { and, eq, lt } from "drizzle-orm";
import { createDb } from "@/lib/db/client";
import { integrityEvent } from "@/lib/db/schema";
import { deletePrivate } from "@/lib/storage";

config({ path: [".env.local", ".env"], quiet: true });

const KEEP_DAYS = 30;

async function main() {
  const db = createDb(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000);
  const old = await db.select().from(integrityEvent).where(and(eq(integrityEvent.type, "snapshot"), lt(integrityEvent.at, cutoff)));
  for (const ev of old) {
    const key = String(ev.meta?.key ?? "");
    if (key) await deletePrivate(key);
    // Keep the timeline entry, without the photo.
    await db.update(integrityEvent).set({ meta: { deleted: true } }).where(eq(integrityEvent.id, ev.id));
  }
  console.info(`Deleted ${old.length} photos older than ${KEEP_DAYS} days.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
