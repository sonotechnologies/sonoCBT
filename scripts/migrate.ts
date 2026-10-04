import { config } from "dotenv";
import { migrate as migrateNeon } from "drizzle-orm/neon-serverless/migrator";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { createDb } from "@/lib/db/client";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  // Migrations prefer Neon's direct (non-pooled) connection.
  const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  const db = createDb(url);
  if (url?.startsWith("pglite:")) {
    await migratePglite(db as unknown as PgliteDatabase, { migrationsFolder: "drizzle" });
  } else {
    await migrateNeon(db as unknown as NeonDatabase, { migrationsFolder: "drizzle" });
  }
  console.info("Migrations applied.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
