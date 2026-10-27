import { expect, type Page } from "@playwright/test";

/**
 * Restore the deterministic mock workspace through the app's own reset control.
 * This is safe: the data is local fixtures, no external mailbox or calendar is
 * touched. Every test that depends on seeded state calls this first.
 */
export async function resetDemo(page: Page): Promise<void> {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(composer(page)).toBeVisible();
}

export function composer(page: Page) {
  return page.getByRole("textbox", { name: "Message Orbit" });
}

export async function sendPrompt(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

/** Create the approval gate for the seeded outbox draft. */
export async function requestDraftSend(page: Page): Promise<void> {
  await sendPrompt(page, "Send it");
  await expect(page.getByText(/APPROVAL REQUIRED/)).toBeVisible();
}
