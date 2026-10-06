/**
 * Installing SonoCBT as an app: the manifest, icons and service worker are in
 * place (the browser reports no problem except our private test window), and
 * /start sends each person to their own home. Seeded test accounts (scripts/seed.ts).
 */
import { expect, test } from "@playwright/test";

test("SonoCBT can be installed as an app and opens at each person's home", async ({ page, context }, info) => {
  test.skip(info.project.name !== "phone");
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "SonoCBT", start_url: "/start", display: "standalone" });
  for (const icon of manifest.icons) {
    const r = await page.request.get(icon.src);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()["content-type"]).toBe("image/png");
  }

  await page.goto("/start");
  await expect(page.getByRole("heading", { name: "Who's signing in?" })).toBeVisible();
  await page.reload();
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname))).toContain("/");
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors.filter((e) => e.errorId !== "in-incognito")).toEqual([]);

  await page.goto("/login");
  await page.getByLabel("Email").fill("proprietor@greenfieldacademy.ng");
  await page.getByLabel("Password").fill("sonocbt-staff-demo");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard$/);
  await page.goto("/start");
  await expect(page).toHaveURL(/\/s\/greenfield-academy\/dashboard$/);
});
