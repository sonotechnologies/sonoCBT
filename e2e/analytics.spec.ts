/**
 * Phase 8 acceptance: "Most-failed questions and weakest topics display for
 * seeded exams." (The figures themselves are checked against the raw answers
 * in lib/analytics/analytics.test.ts.) Seeded test accounts, scripts/seed.ts.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

async function staff(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("sonocbt-staff-demo");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard$/);
  return page;
}

test("exam officer sees most-missed questions, weakest topics and the school overview", async ({ browser }, info) => {
  test.skip(info.project.name !== "lab");
  const page = await staff(browser, "f.adebayo@greenfieldacademy.ng");
  await page.getByRole("link", { name: "Analytics" }).first().click();
  await expect(page.getByRole("heading", { name: "Exam report", level: 1 })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Exam", exact: true })).toHaveValue(/.+/);
  await expect(page.getByRole("combobox", { name: "Exam", exact: true }).locator("option:checked")).toHaveText(/Mathematics CA test 1/);

  const missed = page.getByRole("list", { name: "Most-missed questions" }).getByRole("listitem");
  await expect(missed).toHaveCount(5);
  await expect(missed.first()).toContainText(/Most picked [A-D]/);
  await expect(missed.first()).toContainText(/% correct/);
  await expect(page.getByRole("region", { name: "Topics in this exam" })).toContainText("Logarithms");
  await page.screenshot({ path: "test-results/analytics-exam.png", fullPage: true });

  // Every table exports to CSV.
  const csv = await page.request.get((await page.getByRole("link", { name: /All questions/ }).getAttribute("href"))!);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("Most-picked wrong answer");

  // Topic mastery for Mathematics: both classes, weakest topics listed.
  await page.getByRole("link", { name: "Topic mastery" }).click();
  await expect(page.getByRole("heading", { name: "Topic mastery", level: 1 })).toBeVisible();
  await page.getByRole("combobox", { name: "Subject", exact: true }).selectOption({ label: "Mathematics" });
  await expect(page.getByRole("region", { name: /Mathematics · topic mastery by class/ })).toBeVisible();
  const grid = page.getByRole("table", { name: "Topic mastery" });
  await expect(grid.getByRole("columnheader", { name: "JSS3A" })).toBeVisible();
  await expect(grid.getByRole("columnheader", { name: "JSS3B" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Weakest topics" }).getByRole("listitem").first()).toContainText(/Logarithms|Indices/);
  await page.screenshot({ path: "test-results/analytics-topics.png", fullPage: true });

  await page.getByRole("link", { name: "School overview" }).click();
  await expect(page.getByRole("heading", { name: "School overview", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Students at risk" }).getByRole("row").nth(1)).toBeVisible();
  await expect(page.getByRole("region", { name: "Subjects to watch" })).toContainText("Mathematics · ");
  await page.screenshot({ path: "test-results/analytics-school.png", fullPage: true });
});

test("an HOD sees only their department's exams and no school overview", async ({ browser }, info) => {
  test.skip(info.project.name !== "lab");
  const page = await staff(browser, "k.ade@greenfieldacademy.ng");
  await page.goto(`/s/greenfield-academy/analytics`);
  await expect(page.getByText("Analytics · your subjects")).toBeVisible();
  await expect(page.getByRole("link", { name: "School overview" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Exam", exact: true }).locator("option")).toHaveText([/Mathematics CA test 1/]);
});
