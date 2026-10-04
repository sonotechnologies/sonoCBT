import { PGlite } from "@electric-sql/pglite";
import { Pool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * `postgres://…` → Neon (serverless driver, supports transactions).
 * `pglite:<dir>` → embedded Postgres for local dev; `pglite:` alone is in-memory (tests).
 */
export function createDb(url: string | undefined): Db {
  if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");

  if (url.startsWith("pglite:")) {
    const dir = url.slice("pglite:".length);
    return drizzlePglite(dir ? new PGlite(dir) : new PGlite(), { schema }) as unknown as Db;
  }

  return drizzleNeon(new Pool({ connectionString: url }), { schema }) as unknown as Db;
}
