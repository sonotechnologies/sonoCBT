/**
 * Phase 9 acceptance: "Test payment activates a plan and unlocks gated
 * features." Greenfield has paid Standard this term, so Smart import (Premium)
 * is locked; the admin upgrades through the Paystack test checkout (the
 * in-app stand-in, PAYSTACK_MOCK=1, with a signed webhook) and it unlocks.
 * Then the platform owner console: payments, support sign-in, suspend.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

const SLUG = "greenfield-academy";

async function signIn(browser: Browser, email: string, landing: RegExp): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("sonocbt-staff-demo");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(landing);
  return page;
}

test("a test payment upgrades to Premium and unlocks smart import; the owner console sees it", async ({ browser }, info) => {
  test.skip(info.project.name !== "lab");
  test.setTimeout(180_000);

  const admin = await signIn(browser, "proprietor@greenfieldacademy.ng", /\/dashboard$/);
  await admin.goto(`/s/${SLUG}/import`);
  const locked = admin.getByRole("region", { name: "Smart import from Word and Excel locked" });
  await expect(locked).toContainText("Premium plan");
  await expect(admin.getByRole("heading", { name: "Word document" })).toHaveCount(0);
  await admin.screenshot({ path: "test-results/billing-locked.png" });

  await locked.getByRole("link", { name: "See plans" }).click();
  await expect(admin.getByRole("heading", { name: "Plan and payments" })).toBeVisible();
  await expect(admin.getByRole("status").filter({ hasText: "Standard · paid for" })).toBeVisible();
  const premium = admin.getByRole("region", { name: "Premium plan" });
  await expect(premium).toContainText("Upgrade from Standard");
  await admin.screenshot({ path: "test-results/billing-plans.png", fullPage: true });
  await premium.getByRole("button", { name: "Upgrade to Premium" }).click();

  // Paystack's checkout (test-mode stand-in).
  await admin.waitForURL(/\/dev\/paystack-checkout/);
  await expect(admin.getByText("Test mode stand-in for Paystack")).toBeVisible();
  await admin.getByRole("button", { name: "Pay with test card" }).click();
  await admin.waitForURL(/\/billing\/callback\?reference=/);
  await expect(admin.getByRole("heading", { name: "Premium is active" })).toBeVisible();
  await admin.screenshot({ path: "test-results/billing-paid.png" });

  // The feature is unlocked.
  await admin.goto(`/s/${SLUG}/import`);
  await expect(admin.getByRole("heading", { name: "Word document" })).toBeVisible();
  await expect(admin.getByRole("region", { name: /locked$/ })).toHaveCount(0);

  // The platform owner sees the payment and can help the school.
  const owner = await signIn(browser, "owner@sonocbt.ng", /\/platform$/);
  const row = owner.getByRole("row", { name: /Greenfield Academy/ });
  await expect(row).toContainText("Active");
  await expect(row).toContainText("Premium");
  await owner.screenshot({ path: "test-results/platform-schools.png" });
  await row.getByRole("link", { name: "Greenfield Academy" }).click();
  await expect(owner.getByRole("region", { name: "Plan" })).toContainText("Paid this term: Premium");
  await expect(owner.getByRole("table").getByRole("row")).toHaveCount(4); // header + 2 seeded + the upgrade

  await owner.getByRole("button", { name: "Sign in as school admin" }).click();
  await owner.waitForURL(/\/s\/greenfield-academy\/dashboard$/);
  await expect(owner.getByText(/Support session: you are signed in as Dr\. Adewale Ogunleye/)).toBeVisible();
  await owner.screenshot({ path: "test-results/platform-support.png" });
  await owner.getByRole("button", { name: "End support session" }).click();
  await owner.waitForURL(/\/platform\/schools\//);
  await expect(owner.getByText("Support sign-in started")).toBeVisible();
  await expect(owner.getByText("Support sign-in ended")).toBeVisible();

  // Suspending stops the school's staff signing in (logged with the reason); reactivating lets them back.
  await owner.getByLabel("Reason (goes in the log)").fill("e2e check");
  await owner.getByRole("button", { name: "Suspend school" }).click();
  await expect(owner.getByRole("button", { name: "Reactivate school" })).toBeVisible();
  const teacher = await signIn(browser, "i.musa@greenfieldacademy.ng", /\/suspended\?school=greenfield-academy$/);
  await expect(teacher.getByRole("heading", { name: "Greenfield Academy's account is paused" })).toBeVisible();
  await owner.getByRole("button", { name: "Reactivate school" }).click();
  await expect(owner.getByRole("button", { name: "Suspend school" })).toBeVisible();
  await teacher.goto(`/s/${SLUG}/dashboard`);
  await expect(teacher).toHaveURL(/\/dashboard$/);

  // The demo school can't be suspended.
  await owner.goto("/platform");
  await owner.getByRole("link", { name: "Crestview Model College" }).click();
  await expect(owner.getByText("The demo school can't be suspended.")).toBeVisible();
});

test("the demo school can't make payments", async ({ browser }, info) => {
  test.skip(info.project.name !== "lab");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/demo");
  await page.getByRole("button", { name: "Enter as Admin" }).click();
  await page.waitForURL(/\/s\/crestview\/dashboard$/);
  await page.goto("/s/crestview/billing");
  await expect(page.getByRole("status").filter({ hasText: "Premium · paid for" })).toBeVisible();
});
