/**
 * One-off production database setup:
 *   npm run prod:setup -- --yes            (reads .env.production.local)
 *   npm run prod:setup -- --env=FILE --yes
 *
 * 1. applies every migration,
 * 2. EMPTIES the database (all schools, users and logs),
 * 3. builds the public demo school (Crestview) — its sign-ins are public by design,
 * 4. creates the platform owner from OWNER_EMAIL / OWNER_PASSWORD (keep those
 *    two only in the local file; they are not needed on Vercel).
 * No test schools and no demo passwords for anything but the demo school.
 */
import { spawnSync } from "node:child_process";
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { createPlatformOwner } from "@/lib/accounts";
import { createDb } from "@/lib/db/client";
import { seedDemoSchool } from "./demo/seed-demo";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const file = arg("env") ?? ".env.production.local";
config({ path: file, quiet: true, override: true });

async function main() {
  const direct = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  const email = (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD ?? "";
  if (!direct) throw new Error(`No DATABASE_URL_DIRECT in ${file}.`);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`Add OWNER_EMAIL="you@example.com" to ${file}.`);
  if (password.length < 12) throw new Error(`Add OWNER_PASSWORD (at least 12 characters) to ${file}.`);
  const host = direct.startsWith("pglite:") ? direct : new URL(direct).hostname.replace(/^ep-[a-z0-9-]+/, "ep-…");
  console.info(`Database: ${host}`);
  if (!process.argv.includes("--yes")) {
    console.info("This EMPTIES that database. Run again with --yes to go ahead.");
    process.exit(1);
  }

  console.info("1/4 Migrations…");
  const m = spawnSync("npx", ["tsx", "scripts/migrate.ts"], { stdio: "inherit", shell: true, env: { ...process.env, DATABASE_URL_DIRECT: direct, DATABASE_URL: direct } });
  if (m.status !== 0) throw new Error("Migrations failed.");

  const db = createDb(direct);
  console.info("2/4 Emptying the database…");
  await db.execute(sql`TRUNCATE TABLE "school", "user", "verification", "audit_log" RESTART IDENTITY CASCADE`);

  console.info("3/4 Building the demo school (Crestview Model College)…");
  const t0 = Date.now();
  await seedDemoSchool(db);
  console.info(`    done in ${Math.round((Date.now() - t0) / 1000)} s`);

  console.info("4/4 Creating the platform owner…");
  await createPlatformOwner(db, { name: process.env.OWNER_NAME?.trim() || "SonoCBT", email, password });

  console.info(`\nProduction database ready. Platform owner: ${email} (sign in at /login → /platform).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
