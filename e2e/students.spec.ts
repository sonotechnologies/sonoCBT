/**
 * Moving students: a student who leaves comes off the register and can't sign
 * in; readmitting brings them back. The promotion plan shows each class's
 * destination (not submitted here, so other tests' classes stay put).
 * Seeded test accounts (scripts/seed.ts).
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

const SLUG = "greenfield-academy";
const WHO = "GFA/2021/0200"; // a JSS3A student no other test uses

async function adminPage(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill("proprietor@greenfieldacademy.ng");
  await page.getByLabel("Password").fill("sonocbt-staff-demo");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard$/);
  return page;
}

async function studentSignIn(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/s/${SLUG}/login`);
  await page.getByLabel("Admission number").fill(WHO);
  await page.getByLabel("Password").fill("sonocbt-student");
  await page.getByRole("button", { name: /sign in/i }).click();
  return page;
}

test("a student who leaves is taken off the register and can be readmitted", async ({ browser }, info) => {
  test.skip(info.project.name !== "lab");
  const admin = await adminPage(browser);
  await admin.goto(`/s/${SLUG}/students?q=${encodeURIComponent(WHO)}`);
  const row = admin.getByRole("row", { name: new RegExp(WHO) });
  await expect(row).toContainText("JSS3A");
  await row.getByRole("button", { name: "Change class…" }).click();
  const dialog = admin.getByRole("dialog");
  await dialog.getByPlaceholder("e.g. Moved to another school").fill("Moved to Abuja");
  await dialog.getByRole("button", { name: "Left the school" }).click();
  await expect(dialog).toBeHidden();
  await expect(admin.getByText("No students match.")).toBeVisible();

  const kid = await studentSignIn(browser);
  await expect(kid.getByRole("alert").filter({ hasText: "closed" })).toContainText("This account is closed");

  await admin.getByRole("link", { name: "Left", exact: true }).click();
  const left = admin.getByRole("row", { name: new RegExp(WHO) });
  await expect(left).toContainText("Moved to Abuja");
  await admin.screenshot({ path: "test-results/students-left.png" });
  await left.getByRole("button", { name: "Readmit…" }).click();
  await admin.getByRole("dialog").getByRole("combobox").selectOption({ label: "JSS3A" });
  await admin.getByRole("dialog").getByRole("button", { name: "Readmit" }).click();
  await expect(admin.getByRole("dialog")).toBeHidden();
  await admin.getByRole("link", { name: "On the register" }).click();
  await admin.goto(`/s/${SLUG}/students?q=${encodeURIComponent(WHO)}`);
  await expect(admin.getByRole("row", { name: new RegExp(WHO) })).toContainText("JSS3A");

  const back = await studentSignIn(browser);
  await back.waitForURL(/\/(student|change-password)$/);
});

test("the promotion page suggests where each class goes", async ({ browser }, info) => {
  test.skip(info.project.name !== "lab");
  const admin = await adminPage(browser);
  await admin.goto(`/s/${SLUG}/students`);
  await admin.getByRole("link", { name: "Promote to next class" }).click();
  await expect(admin.getByRole("heading", { name: "Promote to the next class" })).toBeVisible();
  await expect(admin.getByRole("combobox", { name: "JSS3A goes to" }).locator("option:checked")).toHaveText("SS1A");
  await expect(admin.getByRole("combobox", { name: "JSS3B goes to" }).locator("option:checked")).toHaveText("SS1B");
  await admin.getByRole("button", { name: "Exceptions…" }).first().click();
  await expect(admin.getByRole("list", { name: /students$/ }).first()).toBeVisible();
  await admin.screenshot({ path: "test-results/students-promote.png", fullPage: true });
});
