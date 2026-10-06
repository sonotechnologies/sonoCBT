/**
 * Phase 11: every main screen fits a phone without sideways scrolling, and the
 * staff menu opens as a drawer. Seeded test accounts (scripts/seed.ts).
 */
import { expect, test, type Page } from "@playwright/test";

const SLUG = "greenfield-academy";

async function fitsWidth(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(extra, `${path} scrolls sideways by ${extra}px`).toBeLessThanOrEqual(0);
}

test("public pages fit a phone", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  for (const path of ["/", "/features", "/pricing", "/demo", "/login", "/signup", `/results?school=${SLUG}`, "/verify"]) await fitsWidth(page, path);
});

test("staff pages fit a phone and the menu is a drawer", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  test.setTimeout(240_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill("proprietor@greenfieldacademy.ng");
  await page.getByLabel("Password").fill("sonocbt-staff-demo");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard$/);

  // The drawer opens from the header, lists the sections and closes after navigating.
  await page.getByRole("button", { name: "Open menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Menu" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "Students" }).click();
  await page.waitForURL(/\/students$/);
  await expect(drawer).toBeHidden();

  for (const p of ["/dashboard", "/students", "/staff", "/staff/allocation", "/questions", "/exams", "/monitor", "/results", "/results/pins", "/results/setup", "/analytics", "/report-cards", "/billing"]) {
    await fitsWidth(page, `/s/${SLUG}${p}`);
  }
});
