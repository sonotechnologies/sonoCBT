/**
 * The exam officer builds, previews and publishes an exam, then prints slips.
 * Seeded test staff: password "sonocbt-staff-demo" (scripts/seed.ts).
 */
import { expect, test } from "@playwright/test";

const SLUG = "greenfield-academy";

test("exam officer builds and publishes an exam with PINs", async ({ page, context }, info) => {
  test.skip(info.project.name !== "lab");
  await page.goto("/login");
  await page.getByLabel("Email").fill("f.adebayo@greenfieldacademy.ng");
  await page.getByLabel("Password").fill("sonocbt-staff-demo");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard$/);

  // Details
  await page.goto(`/s/${SLUG}/exams`);
  await expect(page.getByRole("link", { name: "JSS3 Mock · Paper 1" })).toBeVisible();
  await page.getByRole("link", { name: "New exam" }).first().click();
  await page.getByLabel(/Exam title/).fill("JSS3 Maths CA test 2");
  await page.getByRole("group", { name: "Subjects" }).getByRole("button", { name: "Mathematics" }).click();
  await page.getByRole("group", { name: "JSS3 classes" }).getByRole("button", { name: "JSS3B" }).click();
  await page.getByLabel("Duration (minutes)").fill("30");
  await page.getByRole("button", { name: "Create exam" }).click();
  await page.waitForURL(/step=questions/);

  // Questions: two from the bank, then a random pick of easy ones.
  await page.getByRole("button", { name: "+ Pick from bank" }).click();
  const picker = page.getByRole("dialog", { name: /Pick questions/ });
  await expect(picker.getByRole("checkbox").first()).toBeVisible();
  await picker.getByRole("checkbox").nth(0).check();
  await picker.getByRole("checkbox").nth(1).check();
  await picker.getByRole("button", { name: /^Add 2 to/ }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByText("2 questions", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "+ Random pick" }).click();
  await page.getByLabel("Difficulty").selectOption("easy");
  await page.getByLabel("How many").fill("3");
  await expect(page.getByText(/approved questions? match/)).toBeVisible();
  await page.getByRole("button", { name: "Add random pick" }).click();
  await expect(page.getByText(/^3 easy Mathematics questions/)).toBeVisible();
  await expect(page.getByText("5 questions", { exact: true })).toBeVisible();

  // Integrity: Strict, plus PINs.
  await page.getByRole("link", { name: /Integrity/ }).click();
  await page.getByRole("button", { name: /Strict/ }).click();
  await page.getByRole("switch", { name: "Exam PIN from a printed slip" }).click();
  await page.getByRole("button", { name: "Save rules" }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  // Schedule: today, opening an hour from now (Lagos time), late entry 15 minutes.
  await page.getByRole("link", { name: /Schedule/ }).click();
  const lagos = new Date(Date.now() + 60 * 60_000 + 60 * 60_000);
  const date = lagos.toISOString().slice(0, 10);
  const hh = String(lagos.getUTCHours()).padStart(2, "0");
  await page.getByLabel("Date").fill(date);
  await page.getByLabel("Opens").fill(`${hh}:00`);
  await page.getByLabel("Late entry until").fill(`${hh}:15`);
  await page.getByLabel("Room for JSS3B").fill("ICT Lab 1");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  // Preview: try it as a student (new tab, nothing saved), then publish.
  await page.getByRole("link", { name: /Preview/ }).click();
  const [tryTab] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: "Try it as a student" }).click()]);
  await expect(tryTab.getByText(/Preview\./)).toBeVisible();
  await expect(tryTab.getByRole("heading", { name: /Question 1 of 5/ })).toBeVisible();
  await tryTab.screenshot({ path: "test-results/builder-try.png" });
  await tryTab.close();

  await page.getByRole("button", { name: "Publish & generate PINs" }).click();
  await expect(page.getByText(/Published: 5 questions, \d+ students seated/)).toBeVisible();
  await page.screenshot({ path: "test-results/builder-published.png" });

  // Slips and the invigilator's PIN sheet.
  await page.getByRole("link", { name: /Exam slips & PINs/ }).first().click();
  await expect(page.getByRole("heading", { name: /Exam slips · JSS3B/ })).toBeVisible();
  await expect(page.getByText("EXAM PIN").first()).toBeVisible();
  await page.screenshot({ path: "test-results/builder-slips.png", fullPage: true });
  // The A4 PDF of the slips.
  const slipsPdf = await page.request.get((await page.getByRole("link", { name: /Slips PDF/ }).getAttribute("href"))!);
  expect(slipsPdf.headers()["content-type"]).toBe("application/pdf");
  expect(slipsPdf.headers()["cache-control"]).toContain("no-store");
  expect((await slipsPdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.getByRole("link", { name: "PIN sheet (invigilator)" }).click();
  await expect(page.locator("td.font-mono").filter({ hasText: /^[2-9A-Z]{4}-[2-9A-Z]{4}$/ }).first()).toBeVisible();
  const sheetPdf = await page.request.get((await page.getByRole("link", { name: "PIN sheet PDF" }).getAttribute("href"))!);
  expect(sheetPdf.headers()["content-type"]).toBe("application/pdf");
  expect(sheetPdf.headers()["content-disposition"]).toContain("PIN sheet");
});
