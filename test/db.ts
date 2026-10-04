import { migrate } from "drizzle-orm/pglite/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { createDb, type Db } from "@/lib/db/client";

/** A fresh in-memory Postgres with all migrations applied. */
export async function createTestDb(): Promise<Db> {
  const db = createDb("pglite:");
  await migrate(db as unknown as PgliteDatabase, { migrationsFolder: "drizzle" });
  return db;
}
