/** Rebuild just the demo school (Crestview) — same as the nightly cron. `npm run demo:reset` */
import { config } from "dotenv";
import { createDb } from "@/lib/db/client";
import { resetDemoSchool } from "@/lib/demo/reset";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  const r = await resetDemoSchool(createDb(url));
  console.info(`Demo school rebuilt in ${r.seconds}s.`);
  process.exit(0);
}
main();
