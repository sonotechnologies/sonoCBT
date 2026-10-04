/**
 * Phase 10 acceptance: "A stranger can try every role in under 2 minutes
 * without signing up." From the home page: Try the demo school → each of the
 * five role cards, checking each lands somewhere useful.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { passFullscreen } from "./helpers";

async function enter(browser: Browser, role: string, landing: RegExp, viewport = { width: 1366, height: 860 }): Promise<Page> {
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto("/");
  await page.getByRole("link", { name: "Try the demo school" }).first().click();
  await page.waitForURL(/\/demo$/);
  await page.getByRole("button", { name: `Enter as ${role}` }).click();
  await page.waitForURL(landing);
  return page;
}

test("a stranger tries every role in under two minutes, without signing up", async ({ browser }, info) => {
  test.skip(info.project.name !== "lab");
  test.setTimeout(240_000);
  const t0 = Date.now();

  const admin = await enter(browser, "Admin", /\/s\/crestview\/dashboard$/);
  await expect(admin.getByRole("heading", { name: /^Good (morning|afternoon|evening), Mrs\. Adeyemi$/ })).toBeVisible();
  await expect(admin.getByText("Demo school — data resets daily.")).toBeVisible();
  await admin.screenshot({ path: "test-results/demo-admin.png", fullPage: true });

  const officer = await enter(browser, "Exam officer", /\/s\/crestview\/exams\/[^/]+\/monitor$/);
  await expect(officer.getByText("JSS3 Mock · Paper 1").first()).toBeVisible();
  await expect(officer.getByText("LIVE", { exact: true })).toBeVisible();
  await officer.screenshot({ path: "test-results/demo-monitor.png" });

  const teacher = await enter(browser, "Teacher", /\/s\/crestview\/marking$/);
  await expect(teacher.getByRole("heading", { name: /theory answers? to mark/ })).toBeVisible();

  const student = await enter(browser, "Student", /\/s\/crestview\/student$/, { width: 412, height: 860 });
  await student.getByRole("link", { name: "Go to exam lobby" }).click();
  await student.getByRole("button", { name: "Start exam" }).locator("visible=true").click();
  await student.waitForURL(/\/take$/);
  await passFullscreen(student);
  await student.keyboard.press("b");
  await expect(student.getByText("All answers saved").locator("visible=true").first()).toBeVisible();
  await student.screenshot({ path: "test-results/demo-student.png" });

  const parent = await enter(browser, "Parent", /\/results\/view$/, { width: 412, height: 860 });
  await expect(parent.getByRole("list", { name: "Subjects" }).getByRole("listitem").first()).toBeVisible();
  await expect(parent.getByRole("link", { name: "Download PDF report card" })).toBeVisible();

  const seconds = (Date.now() - t0) / 1000;
  console.info(`Every role tried in ${seconds.toFixed(1)} s`);
  expect(seconds).toBeLessThan(120);
});

test("the marketing pages render, and search engines get a sitemap and share image", async ({ page }, info) => {
  test.skip(info.project.name !== "lab");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Exams and results your school can trust." })).toBeVisible();
  await page.screenshot({ path: "test-results/marketing-home.png", fullPage: true });
  for (const [path, heading] of [
    ["/features", "Everything a term needs."],
    ["/pricing", "Priced per student, per term."],
    ["/demo", "Walk around Crestview Model College."],
    ["/contact", "Talk to us."],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
  }
  await page.goto("/demo");
  await page.screenshot({ path: "test-results/marketing-demo.png", fullPage: true });
  expect(await page.getAttribute('meta[property="og:image"]', "content")).toContain("/opengraph-image");
  const sitemap = await page.request.get("/sitemap.xml");
  expect(await sitemap.text()).toContain("/pricing");
  expect((await page.request.get("/robots.txt")).ok()).toBe(true);
  const sample = await page.request.get("/samples/sample-english-comprehension.docx");
  expect(sample.ok()).toBe(true);
});
