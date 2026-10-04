import "server-only";
import { createDb, type Db } from "./client";

export type { Db };

const globalForDb = globalThis as unknown as { __sonoDb?: Db };

/** The app's database, created lazily once per server process (so builds don't need DATABASE_URL). */
export function getDb(): Db {
  return (globalForDb.__sonoDb ??= createDb(process.env.DATABASE_URL));
}
