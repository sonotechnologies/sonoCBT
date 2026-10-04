import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a production build backed by a throwaway PGlite
 * database (scripts/e2e-server.mjs), with the installed Microsoft Edge, so no
 * browser download is needed. Set E2E_DEV=1 to use `next dev` instead.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    channel: "msedge",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "lab", use: { viewport: { width: 1366, height: 768 } } },
    { name: "phone", use: { ...devices["Pixel 7"], channel: "msedge" } },
  ],
  webServer: {
    command: process.env.E2E_DEV ? "node scripts/e2e-server.mjs" : "node scripts/e2e-server.mjs --prod",
    url: "http://localhost:3100/s/greenfield-academy/login",
    timeout: 900_000,
    // Always a fresh, freshly seeded server: the tests take each student's exam once.
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
});
