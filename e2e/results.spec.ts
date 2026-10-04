/**
 * Phase 6: a student's theory answer is marked (names hidden), a teacher types
 * CA scores into the grid, and the class goes draft → review → approved →
 * released. Scaling, positions and ties are checked against hand arithmetic in
 * lib/results/acceptance.test.ts; this walks the screens.
 *
 * Seeded test accounts (scripts/seed.ts).
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { passFullscreen } from "./helpers";

const SLUG = "greenfield-academy";

async function staff(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "e2e reason" : undefined));
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("sonocbt-staff-demo");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard$/);
  return page;
}

test("theory marking, CA grid and the release workflow", async ({ browser }, info) => {
  test.skip(info.project.name !== "lab");
  test.setTimeout(180_000);

  // A student answers a theory question in Paper 1 and submits.
  const kid = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  await kid.goto(`/s/${SLUG}/login`);
  await kid.getByLabel("Admission number").fill("GFA/2021/0153");
  await kid.getByLabel("Password").fill("sonocbt-student");
  await kid.getByRole("button", { name: /sign in/i }).click();
  await kid.waitForURL(/\/(student|change-password)$/);
  await kid.goto(`/s/${SLUG}/student`);
  if (kid.url().endsWith("/change-password")) {
    await kid.locator('input[name="currentPassword"]').fill("sonocbt-student");
    await kid.locator('input[name="newPassword"]').fill("e2e-test-password-1");
    await kid.locator('input[name="confirm"]').fill("e2e-test-password-1");
    await kid.getByRole("button", { name: /save/i }).click();
    await kid.waitForURL(/\/student$/);
  }
  await kid.getByRole("link", { name: "Go to exam lobby" }).click();
  await kid.getByRole("button", { name: "Start exam" }).locator("visible=true").click();
  await kid.waitForURL(/\/take$/);
  await passFullscreen(kid);
  await kid.locator('aside[aria-label="Question navigator"] button[aria-label^="Question 29"]').click();
  await kid.getByLabel("Your answer").fill("Photosynthesis makes glucose from carbon dioxide and water using light energy, releasing oxygen.");
  await expect(kid.getByText("All answers saved").locator("visible=true").first()).toBeVisible();
  await kid.getByRole("button", { name: "Submit exam" }).locator("visible=true").click();
  await kid.getByRole("dialog", { name: "Submit your exam?" }).getByRole("button", { name: /Yes, submit/ }).click();
  await expect(kid.getByRole("heading", { name: "Your exam has been submitted" })).toBeVisible();

  // The subject teacher marks it without seeing who wrote it.
  const musa = await staff(browser, "i.musa@greenfieldacademy.ng");
  await musa.getByRole("link", { name: "Marking" }).first().click();
  await expect(musa.getByRole("heading", { name: /theory answers? to mark/ })).toBeVisible();
  await musa.getByRole("region", { name: /JSS3 Mock · Paper 1/ }).getByRole("link").first().click();
  await expect(musa.getByRole("heading", { name: "Theory marking" })).toBeVisible();
  await expect(musa.getByText("Marking guide", { exact: true })).toBeVisible();
  await expect(musa.getByText(/Ngozi|Chiamaka|GFA\/2021/)).toHaveCount(0);
  const bar = musa.getByRole("progressbar", { name: "Scripts marked" });
  const before = Number(await bar.getAttribute("aria-valuenow"));
  await musa.keyboard.press("4");
  await expect(musa.getByRole("group", { name: "Score" }).getByRole("button", { name: "4", exact: true })).toHaveAttribute("aria-pressed", "true");
  await musa.keyboard.press("Enter");
  await expect(bar).toHaveAttribute("aria-valuenow", String(before + 1));
  await musa.screenshot({ path: "test-results/theory-marking.png" });

  // CA grid: type a French CA1 score, see the total move, and find it saved after a reload.
  await musa.goto(`/s/${SLUG}/results/classes`);
  await musa.getByRole("link", { name: /JSS3B/ }).first().click();
  await musa.getByRole("link", { name: "French", exact: true }).click();
  await expect(musa.getByRole("heading", { name: "French · CA scores" })).toBeVisible();
  const cell = musa.getByRole("textbox", { name: / CA1$/ }).first();
  const label = (await cell.getAttribute("aria-label"))!;
  await cell.fill("8");
  await cell.press("Enter");
  await expect(musa.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible({ timeout: 10_000 });
  await musa.screenshot({ path: "test-results/ca-grid.png" });
  await musa.reload();
  await expect(musa.getByRole("textbox", { name: label })).toHaveValue("8");
  await expect(musa.getByRole("textbox", { name: /^.+ CA1$/ }).nth(0)).toBeEditable();

  // A score above the part's maximum is refused.
  const next = musa.getByRole("textbox", { name: / CA2$/ }).first();
  await next.fill("12");
  await next.press("Enter");
  await expect(next).toHaveAttribute("aria-invalid", "true");
  await expect(next).toHaveAttribute("title", "More than 10");
  await next.fill("");
  await next.press("Enter");

  // Broadsheet.
  await musa.getByRole("link", { name: "Broadsheet", exact: true }).click();
  await expect(musa.getByRole("heading", { name: "Class broadsheet" })).toBeVisible();
  await expect(musa.getByRole("columnheader", { name: "Pos." })).toBeVisible();
  await musa.screenshot({ path: "test-results/broadsheet.png" });

  // The form teacher sends the class for review; the grid locks for teachers.
  await musa.getByRole("button", { name: "Send for review" }).click();
  await expect(musa.getByText("In review").first()).toBeVisible();
  await musa.getByRole("link", { name: "CA scores", exact: true }).click();
  await expect(musa.getByText(/These scores are read-only for you/)).toBeVisible();

  // The exam officer approves it.
  const officer = await staff(browser, "f.adebayo@greenfieldacademy.ng");
  await officer.goto(`/s/${SLUG}/results`);
  await officer.getByRole("button", { name: "Approve" }).first().click();
  await expect(officer.getByRole("status").filter({ hasText: /approved/ })).toBeVisible();
  await expect(officer.getByRole("button", { name: "Release to parents" })).toHaveCount(0);

  // The school admin releases it.
  const admin = await staff(browser, "proprietor@greenfieldacademy.ng");
  await admin.goto(`/s/${SLUG}/results`);
  await admin.getByRole("checkbox", { name: "Select JSS3B" }).click();
  await admin.getByRole("button", { name: "Release to parents" }).click();
  const dialog = admin.getByRole("dialog");
  await expect(dialog).toContainText("students' results become visible");
  await admin.screenshot({ path: "test-results/release-confirm.png" });
  await dialog.getByRole("button", { name: "Release now" }).click();
  await expect(admin.getByRole("status").filter({ hasText: /released/ })).toBeVisible();

  // The change log tells the story.
  await admin.getByRole("checkbox", { name: "Select JSS3B" }).locator("xpath=..").getByRole("link", { name: "Log" }).click();
  for (const what of ["Released to students and parents", "Approved", "Sent for review"]) await expect(admin.getByText(what).first()).toBeVisible();
  await admin.screenshot({ path: "test-results/release-log.png" });

  // Un-releasing needs a reason and takes it back to approved (and leaves the class unreleased for the parent test).
  await admin.getByRole("checkbox", { name: "Select JSS3B" }).locator("xpath=..").getByRole("button", { name: "Un-release" }).click();
  await expect(admin.getByRole("status").filter({ hasText: /un-released/ })).toBeVisible();
  await expect(admin.getByText(/Un-released \(e2e reason\)/).first()).toBeVisible();
});
