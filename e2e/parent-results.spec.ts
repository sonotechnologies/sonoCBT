/**
 * Phase 7 acceptance: "Parent views a released report card with a PIN;
 * unreleased returns 'not yet released'." Plus the PDF, the verify page, and
 * the staff side: remarks and ratings, class PDFs, and printable PIN sheets.
 *
 * Seeded test PINs and accounts (scripts/seed.ts).
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

const SLUG = "greenfield-academy";

async function staff(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("sonocbt-staff-demo");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard$/);
  return page;
}

test("a parent opens a released report card with a PIN; an unreleased term says not yet released", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");

  await page.goto(`/results?school=${SLUG}`);
  await page.getByLabel("Admission number").fill("gfa/2021/0147");
  await page.getByLabel("Result PIN").fill("4821 7730 5519");
  await page.getByLabel("Term").selectOption({ label: "3rd Term · 2025/2026" });
  await page.getByRole("button", { name: "View result" }).click();
  await page.waitForURL(/\/results\/view$/);
  await expect(page.getByRole("heading", { name: "Chiamaka Okafor" })).toBeVisible();
  await expect(page.getByText("JSS2B · 3rd Term 2025/2026")).toBeVisible();
  await expect(page.getByRole("list", { name: "Subjects" }).getByRole("listitem")).toHaveCount(8);
  await expect(page.getByText(/Principal:/)).toBeVisible();
  await page.screenshot({ path: "test-results/parent-report-card.png" });

  // The PDF is the full A4 report card.
  const pdf = await page.request.get("/results/view/pdf");
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Its verification code checks out on the public verify page.
  const code = (await page.locator("p", { hasText: "Verification code" }).locator("span.font-mono").textContent())!;
  expect(code).toMatch(/^GFA-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  await page.getByRole("link", { name: "check it" }).click();
  await expect(page.getByRole("heading", { name: /Genuine report card/ })).toBeVisible();
  await expect(page.getByText("Chiamaka Okafor")).toBeVisible();
  await page.screenshot({ path: "test-results/verify-genuine.png" });

  // This term's results aren't released yet: the checker says so and the PIN isn't used.
  await page.goto(`/results?school=${SLUG}`);
  await page.getByLabel("Admission number").fill("GFA/2021/0147");
  await page.getByLabel("Result PIN").fill("915530287746");
  await page.getByLabel("Term").selectOption({ label: "1st Term · 2026/2027" });
  await page.getByRole("button", { name: "View result" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "released" });
  await expect(alert).toContainText("have not been released yet");
  await expect(alert).toContainText("Your PIN has not been used");
  await page.screenshot({ path: "test-results/parent-not-released.png" });

  // Without a checked PIN there's no PDF.
  const fresh = await page.context().browser()!.newContext();
  expect((await fresh.request.get(`${new URL(page.url()).origin}/results/view/pdf`)).status()).toBe(401);
  await fresh.close();
});

test("form teacher fills remarks; staff download class PDFs; the admin prints PIN cards", async ({ browser }, info) => {
  test.skip(info.project.name !== "lab");
  test.setTimeout(120_000);

  const musa = await staff(browser, "i.musa@greenfieldacademy.ng");
  await musa.getByRole("link", { name: "Report cards" }).first().click();
  await musa.waitForURL(/\/report-cards$/);
  await musa.getByRole("link", { name: /JSS3B/ }).click();
  await expect(musa.getByRole("heading", { name: "JSS3B" })).toBeVisible();
  const panel = musa.getByRole("complementary", { name: "Report card details" });
  await panel.getByLabel("Form teacher's remark").fill("Settled in well this term.");
  await panel.getByRole("radio", { name: "Punctuality 5" }).click();
  await panel.getByLabel("Days present").fill("40");
  await panel.getByLabel("Days school opened").fill("44");
  await expect(panel.getByLabel("Principal's remark")).toBeDisabled();
  await panel.getByRole("button", { name: "Save & next student" }).click();
  await expect(panel.getByRole("status")).toHaveText("Saved");
  await expect(musa.getByText("1 of 38 remarks written")).toBeVisible();
  await musa.screenshot({ path: "test-results/report-card-remarks.png" });

  // Not released yet: the preview is a watermarked PDF.
  const href = (await musa.getByRole("link", { name: "Preview class PDF" }).getAttribute("href"))!;
  const preview = await musa.request.get(href);
  expect(preview.headers()["content-type"]).toBe("application/pdf");
  expect((await preview.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // The admin: last term's released class as one PDF and as a zip.
  const admin = await staff(browser, "proprietor@greenfieldacademy.ng");
  await admin.goto(`/s/${SLUG}/report-cards`);
  await admin.getByRole("link", { name: "3rd Term 2025/2026" }).click();
  await expect(admin.getByText("Report cards · 3rd Term 2025/2026")).toBeVisible();
  await admin.getByRole("link", { name: /JSS2B/ }).click();
  const classPdf = await admin.request.get((await admin.getByRole("link", { name: "Download class PDF" }).getAttribute("href"))!);
  expect(classPdf.headers()["content-type"]).toBe("application/pdf");
  expect(((await classPdf.body()).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(38);
  const zip = await admin.request.get((await admin.getByRole("link", { name: /One PDF per student/ }).getAttribute("href"))!);
  expect(zip.headers()["content-type"]).toBe("application/zip");
  expect(zip.headers()["content-disposition"]).toContain("JSS2B report cards");

  // Result PINs: make a batch and print it.
  await admin.goto(`/s/${SLUG}/results`);
  await admin.getByRole("link", { name: "PINs", exact: true }).click();
  await admin.getByLabel("How many").fill("12");
  await admin.getByLabel("Views per PIN").fill("3");
  await admin.getByRole("button", { name: "Make PINs" }).click();
  await expect(admin.getByRole("status")).toContainText("12 PINs made");
  const form = admin.locator("form", { has: admin.getByRole("button", { name: "Download PIN sheet (PDF)" }) });
  const sheet = await admin.request.post((await form.getAttribute("action"))!, {
    multipart: { batch: (await form.locator('input[name="batch"]').inputValue())!, pins: (await form.locator('input[name="pins"]').inputValue())! },
  });
  expect(sheet.status()).toBe(200);
  expect(sheet.headers()["content-type"]).toBe("application/pdf");
  expect(((await sheet.body()).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(2);
  await admin.getByRole("button", { name: "I've saved it" }).click();
  await admin.reload();
  await expect(admin.getByRole("cell", { name: /^B-\d{8}-1$/ })).toBeVisible();
  await admin.screenshot({ path: "test-results/result-pins.png" });
});
