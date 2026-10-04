/**
 * Phase 4 acceptance: "Kill network mid-exam, answer 5 more questions, close
 * the tab, reopen: all answers present and timer correct."
 *
 * Uses seeded test students (scripts/seed.ts, password "sonocbt-student").
 * Classmates must set a new password on first sign-in; this test uses its own
 * test-only one below.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { passFullscreen } from "./helpers";

const SLUG = "greenfield-academy";
const SEED_PASSWORD = "sonocbt-student";
const NEW_PASSWORD = "e2e-test-password-1";

async function signIn(page: Page, admissionNo: string) {
  await page.goto(`/s/${SLUG}/login`);
  await page.getByLabel("Admission number").fill(admissionNo);
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(student|change-password)$/);
  // The home page sends first-timers on to change their password.
  await page.goto(`/s/${SLUG}/student`);
  if (page.url().endsWith("/change-password")) {
    await page.locator('input[name="currentPassword"]').fill(SEED_PASSWORD);
    await page.locator('input[name="newPassword"]').fill(NEW_PASSWORD);
    await page.locator('input[name="confirm"]').fill(NEW_PASSWORD);
    await page.getByRole("button", { name: /save|change|continue/i }).click();
    await page.waitForURL(/\/student$/);
  }
}

async function signInAgain(page: Page, admissionNo: string) {
  await page.goto(`/s/${SLUG}/login`);
  await page.getByLabel("Admission number").fill(admissionNo);
  await page.getByLabel("Password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/student$/);
}

async function openExam(page: Page) {
  await page.getByRole("link", { name: "Go to exam lobby" }).click();
  await page.getByRole("button", { name: "Start exam" }).locator("visible=true").click();
  await page.waitForURL(/\/take$/);
  await passFullscreen(page);
  await expect(page.getByText("All answers saved").locator("visible=true").first()).toBeVisible();
}

/** The exam officer releases the student's computer from the live monitor ("Reset session"). */
async function resetSessionFromMonitor(browser: Browser, admissionNo: string) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill("f.adebayo@greenfieldacademy.ng");
  await page.getByLabel("Password").fill("sonocbt-staff-demo");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard$/);
  await page.goto(`/s/${SLUG}/monitor`);
  await page.getByRole("link", { name: /JSS3 Mock · Paper 1/ }).click();
  await page.getByLabel("Search students").fill(admissionNo);
  await page.getByRole("list", { name: "Students" }).getByRole("button").first().click();
  await page.getByRole("button", { name: "Reset session" }).click();
  await expect(page.getByText(/can sign in again on any computer/)).toBeVisible();
  await ctx.close();
}

/** Seconds on the visible timer. */
async function timerSeconds(page: Page): Promise<number> {
  const text = (await page.getByRole("timer").locator("visible=true").first().textContent())!.trim();
  const parts = text.split(":").map(Number);
  return parts.reduce((s, n) => s * 60 + n, 0);
}

/** "answered" / "not answered" for each question, from the navigator. */
async function navigatorState(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('aside[aria-label="Question navigator"] button[aria-label^="Question"]')].map((b) =>
      /, answered/.test(b.getAttribute("aria-label") ?? "") ? "answered" : "open",
    ),
  );
}

/** Picks option B (or A) on the current question and returns the chosen option's text. */
async function answerCurrent(page: Page, letter: "a" | "b" = "b"): Promise<string> {
  await page.keyboard.press(letter);
  const chosen = page.locator('#exam-question [role="radio"][aria-checked="true"]');
  await expect(chosen).toHaveCount(1);
  return (await chosen.textContent())!.slice(1).trim();
}

async function selectedText(page: Page): Promise<string | null> {
  const chosen = page.locator('#exam-question [role="radio"][aria-checked="true"]');
  return (await chosen.count()) ? (await chosen.textContent())!.slice(1).trim() : null;
}

test.describe("exam runtime", () => {
  test("lab: offline answers survive closing the tab; timer stays on the server's clock", async ({ page, context, browser }, info) => {
    test.skip(info.project.name !== "lab");
    await signIn(page, "GFA/2021/0150");
    await page.goto(`/s/${SLUG}/student`);
    await openExam(page);
    const takeUrl = page.url();

    // The service worker must be in control and have the page cached before we go offline.
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 60_000 });
    await page.waitForFunction(async () => !!(await caches.match(location.href)), null, { timeout: 60_000 });
    await expect(page.locator("html")).toHaveAttribute("data-offline-ready", "yes", { timeout: 60_000 });

    // Three answers online.
    const answers = new Map<number, string>();
    for (let i = 1; i <= 3; i++) {
      answers.set(i, await answerCurrent(page));
      await page.keyboard.press("n");
    }
    await expect(page.getByText("All answers saved").locator("visible=true").first()).toBeVisible();

    // Kill the network, answer five more.
    await context.setOffline(true);
    for (let i = 4; i <= 8; i++) {
      answers.set(i, await answerCurrent(page, "a"));
      if (i < 8) await page.keyboard.press("n");
    }
    await expect(page.getByText(/Offline — your answers are safe/)).toBeVisible();
    await expect(page.getByText("Saved on this device").first()).toBeVisible();
    await page.screenshot({ path: "test-results/lab-offline.png" });

    const before = await timerSeconds(page);
    const t0 = Date.now();

    // Close the tab. Reopen it, still offline.
    await page.close();
    const again = await context.newPage();
    await again.goto(takeUrl);
    await passFullscreen(again);
    await expect(again.getByRole("heading", { name: /Question 8 of/ })).toBeVisible();
    const state = await navigatorState(again);
    expect(state.slice(0, 8)).toEqual(Array(8).fill("answered"));
    expect(state.filter((s) => s === "answered")).toHaveLength(8);
    for (const [n, text] of answers) {
      await again.locator(`aside[aria-label="Question navigator"] button[aria-label^="Question ${n},"]`).click();
      expect(await selectedText(again), `question ${n}`).toBe(text);
    }
    const elapsed = Math.round((Date.now() - t0) / 1000);
    expect(Math.abs((await timerSeconds(again)) - (before - elapsed))).toBeLessThanOrEqual(3);
    await again.screenshot({ path: "test-results/lab-reopened-offline.png" });

    // Back online: everything syncs.
    await context.setOffline(false);
    await expect(again.getByText(/Reconnected — all answers saved/)).toBeVisible({ timeout: 30_000 });
    await expect(again.getByText("All answers saved").first()).toBeVisible();

    // The student moves to another computer: the first is closed and the invigilator resets the session.
    // That device (no local copy) sees all eight from the server, with the same deadline.
    const left = await timerSeconds(again);
    const t1 = Date.now();
    await again.close();
    await resetSessionFromMonitor(browser, "GFA/2021/0150");
    await checkFromAnotherDevice(browser, "GFA/2021/0150", takeUrl, answers, left - Math.round((Date.now() - t1) / 1000));
  });

  test("phone: navigator and passage sheets, then submit", async ({ page }, info) => {
    test.skip(info.project.name !== "phone");
    await signIn(page, "GFA/2021/0151");
    await page.goto(`/s/${SLUG}/student`);
    await openExam(page);

    await page.getByRole("radio").first().click();
    await page.getByRole("button", { name: "Next question" }).click();
    await page.getByRole("radio").nth(1).click();
    await page.getByRole("button", { name: "Flag" }).click();

    await page.getByRole("button", { name: "Open question navigator" }).click();
    const sheet = page.getByRole("dialog", { name: "Question navigator" });
    await expect(sheet.getByText("2 answered")).toBeVisible();
    await expect(sheet.getByText("1 flagged")).toBeVisible();
    await page.screenshot({ path: "test-results/phone-navigator.png" });

    // Jump to a passage question (the passage sits somewhere in the English section) and open it.
    expect(await sheet.locator('button[aria-label^="Question"]').count()).toBe(30);
    const goTo = async (n: number) => {
      if (!(await sheet.isVisible())) await page.getByRole("button", { name: "Open question navigator" }).click();
      await sheet.locator(`button[aria-label^="Question ${n},"]`).click();
      await expect(sheet).toBeHidden();
    };
    for (let n = 1; n <= 8; n++) {
      await goTo(n);
      if (await page.getByRole("button", { name: /Passage/ }).isVisible()) break;
    }
    await page.getByRole("button", { name: /Passage/ }).click();
    await expect(page.getByRole("dialog", { name: "Passage" }).getByText("The Harmattan Market")).toBeVisible();
    await page.screenshot({ path: "test-results/phone-passage.png" });
    await page.getByRole("button", { name: "Back to question" }).click();

    await page.getByRole("button", { name: "Open question navigator" }).click();
    await page.getByRole("button", { name: "Review & submit" }).click();
    const dialog = page.getByRole("dialog", { name: "Submit your exam?" });
    await expect(dialog.getByText("Not answered — tap to go there")).toBeVisible();
    await dialog.getByRole("button", { name: /Yes, submit/ }).click();
    await expect(page.getByRole("heading", { name: "Your exam has been submitted" })).toBeVisible();
    await expect(page.getByText(/2 of 30/)).toBeVisible();
    await page.screenshot({ path: "test-results/phone-submitted.png" });

    // Coming back shows the submitted screen, not the exam.
    await page.goto(page.url());
    await expect(page.getByRole("heading", { name: "You have submitted this exam" })).toBeVisible();
  });
});

async function checkFromAnotherDevice(browser: Browser, admissionNo: string, takeUrl: string, answers: Map<number, string>, expectedSeconds: number) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  const t0 = Date.now();
  await signInAgain(page, admissionNo);
  // The lobby offers to resume where the student was.
  await page.goto(takeUrl.replace(/\/take$/, ""));
  await expect(page.getByText("Your answers are safe")).toBeVisible();
  await expect(page.getByText("8 / 30")).toBeVisible();
  await page.getByRole("link", { name: /Continue from question 8/ }).click();
  await page.waitForURL(/\/take$/);
  await passFullscreen(page);
  await expect(page.getByText("All answers saved").locator("visible=true").first()).toBeVisible();
  const state = await navigatorState(page);
  expect(state.filter((s) => s === "answered")).toHaveLength(8);
  for (const [n, text] of answers) {
    await page.locator(`aside[aria-label="Question navigator"] button[aria-label^="Question ${n},"]`).click();
    expect(await selectedText(page), `question ${n} on the second device`).toBe(text);
  }
  const elapsed = Math.round((Date.now() - t0) / 1000);
  expect(Math.abs((await timerSeconds(page)) - (expectedSeconds - elapsed))).toBeLessThanOrEqual(3);
  await ctx.close();
}
