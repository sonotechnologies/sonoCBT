import { expect, type Page } from "@playwright/test";

/** Paper 1 is Strict: it asks for full screen before anything else. */
export async function passFullscreen(page: Page) {
  const gate = page.getByRole("dialog", { name: "This exam runs in full screen" });
  await gate.waitFor({ timeout: 10_000 }).catch(() => {});
  if (await gate.isVisible()) {
    await gate.getByRole("button", { name: "Go full screen" }).click();
    await expect(gate).toBeHidden();
  }
}

