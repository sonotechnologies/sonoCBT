/**
 * Runs the app against a throwaway on-disk Postgres (PGlite) for end-to-end
 * tests and trying the exam runtime, on its own port and build folder so it
 * never touches the real database or the normal dev server.
 *
 *   node scripts/e2e-server.mjs            # migrate + seed (exam open now) + next dev on :3100
 *   node scripts/e2e-server.mjs --prod     # same, but next build + next start
 */
import { spawnSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Work from the project folder wherever this is started from.
process.chdir(fileURLToPath(new URL("..", import.meta.url)));

const PORT = process.env.E2E_PORT || "3100";
const prod = process.argv.includes("--prod");
const env = {
  ...process.env,
  DATABASE_URL: "pglite:./.pglite-e2e",
  DATABASE_URL_DIRECT: "pglite:./.pglite-e2e",
  DATABASE_URL_UNPOOLED: "",
  BETTER_AUTH_URL: `http://localhost:${PORT}`,
  NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
  BETTER_AUTH_SECRET: process.env.E2E_AUTH_SECRET || "e2e-only-secret-not-for-production-0123456789",
  RESULTS_TOKEN_SECRET: "e2e-only-results-secret-0123456789",
  BREVO_API_KEY: "",
  RESEND_API_KEY: "",
  GEMINI_API_KEY: "",
  // Payments go to the in-app Flutterwave stand-in (no keys, no network).
  FLUTTERWAVE_MOCK: "1",
  FLUTTERWAVE_WEBHOOK_HASH: "",
  // One-click demo sign-in (Phase 10) is off in production builds unless asked for.
  DEMO_MODE: "1",
  FLUTTERWAVE_SECRET_KEY: "",
  SEED_EXAM_OPEN: "1",
  NEXT_DIST_DIR: prod ? ".next-e2e-prod" : ".next-e2e",
};

const run = (args) => {
  const r = spawnSync("npx", args, { env, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

rmSync(".pglite-e2e", { recursive: true, force: true });
run(["tsx", "scripts/migrate.ts"]);
run(["tsx", "--conditions=react-server", "scripts/seed.ts"]);
if (prod) run(["next", "build"]);
const child = spawn("npx", ["next", prod ? "start" : "dev", "-p", PORT], { env, stdio: "inherit", shell: true });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
