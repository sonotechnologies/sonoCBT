/**
 * Phase 5 acceptance: "Tab switching in Strict auto-submits after 3 events and
 * shows on the monitor within 20s."
 *
 * Leaving is simulated by the window losing focus for a couple of seconds and
 * getting it back (what alt-tab or switching tabs does), since a headless
 * browser has no other windows to switch to.
 */
import { expect, test, type Page } from "@playwright/test";
import { passFullscreen } from "./helpers";

const SLUG = "greenfield-academy";

async function leaveAndComeBack(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

test("Strict: the third tab switch submits the exam and the monitor shows it within 20 s", async ({ browser }, info) => {
  test.skip(info.project.name !== "lab");

  // The exam officer opens the live monitor first.
  const staff = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const monitor = await staff.newPage();
  await monitor.goto("/login");
  await monitor.getByLabel("Email").fill("f.adebayo@greenfieldacademy.ng");
  await monitor.getByLabel("Password").fill("sonocbt-staff-demo");
  await monitor.getByRole("button", { name: /sign in/i }).click();
  await monitor.waitForURL(/\/dashboard$/);
  await monitor.getByRole("link", { name: "Live monitor" }).first().click();
  await monitor.getByRole("link", { name: /JSS3 Mock · Paper 1/ }).click();
  await monitor.waitForURL(/\/exams\/[^/]+\/monitor$/);
  await expect(monitor.getByText("LIVE", { exact: true })).toBeVisible();

  // A student starts the exam.
  const kid = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await kid.newPage();
  await page.goto(`/s/${SLUG}/login`);
  await page.getByLabel("Admission number").fill("GFA/2021/0152");
  await page.getByLabel("Password").fill("sonocbt-student");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(student|change-password)$/);
  await page.goto(`/s/${SLUG}/student`);
  if (page.url().endsWith("/change-password")) {
    await page.locator('input[name="currentPassword"]').fill("sonocbt-student");
    await page.locator('input[name="newPassword"]').fill("e2e-test-password-1");
    await page.locator('input[name="confirm"]').fill("e2e-test-password-1");
    await page.getByRole("button", { name: /save/i }).click();
    await page.waitForURL(/\/student$/);
  }
  await page.getByRole("link", { name: "Go to exam lobby" }).click();
  await page.getByRole("button", { name: "Start exam" }).locator("visible=true").click();
  await page.waitForURL(/\/take$/);
  await passFullscreen(page);
  await page.keyboard.press("b");
  await expect(page.getByText("All answers saved").locator("visible=true").first()).toBeVisible();

  // Two warnings…
  for (const n of [1, 2]) {
    await leaveAndComeBack(page);
    const warn = page.getByRole("alertdialog", { name: "You left the exam window" });
    await expect(warn).toContainText(`(${n} of 3)`);
    await warn.getByRole("button", { name: "Back to the exam" }).click();
  }
  await expect(monitor.getByRole("button", { name: /Ngozi Eze, Q\d+ of 30, 2 flags/ })).toBeVisible({ timeout: 20_000 });
  await monitor.screenshot({ path: "test-results/monitor-flagged.png" });

  // …and the third ends the exam.
  await leaveAndComeBack(page);
  const t0 = Date.now();
  await expect(page.getByRole("heading", { name: "Your exam has been submitted" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/You left the exam window too many times/)).toBeVisible();
  await page.screenshot({ path: "test-results/student-auto-submitted.png" });

  // The monitor shows it without a reload, within 20 s.
  await expect(monitor.getByRole("button", { name: /Ngozi Eze, Auto-submitted · tab switches, 3 flags/ })).toBeVisible({ timeout: 20_000 });
  expect(Date.now() - t0).toBeLessThan(20_000);
  await monitor.getByRole("button", { name: /Ngozi Eze/ }).click();
  await expect(monitor.getByText("Submitted automatically")).toBeVisible();
  await expect(monitor.getByText("after 3 tab switches")).toBeVisible();
  await monitor.screenshot({ path: "test-results/monitor-auto-submitted.png" });

  await staff.close();
  await kid.close();
});
