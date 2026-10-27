import { expect, type Page } from "@playwright/test";
import { test } from "@playwright/test";
import { composer, resetDemo, sendPrompt } from "../helpers/demo";

const transcript = (page: Page) => page.getByTestId("chat-transcript");
const conversation = (page: Page, title: string | RegExp) =>
  page.getByTestId("conversation-item").filter({ hasText: title });

async function openMenu(page: Page, title: string | RegExp) {
  await conversation(page, title)
    .locator("..")
    .getByTestId("conversation-menu-button")
    .click();
  return page.getByTestId("conversation-menu");
}

test.describe("conversation management", () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page);
  });

  test("search filters the history and reports an empty result", async ({ page }) => {
    await sendPrompt(page, "Summarize the thread from Marcus");
    await expect(transcript(page).getByText(/Pricing page copy/).first()).toBeVisible();

    const search = page.getByTestId("sidebar-search");
    await search.fill("Marcus");
    await expect(conversation(page, /Summarize the thread from Marcus/)).toHaveCount(1);
    await expect(conversation(page, /Welcome to Orbit/)).toHaveCount(0);

    await search.fill("no-such-conversation-anywhere");
    await expect(page.getByText(/No conversations match/)).toBeVisible();

    await page.getByRole("button", { name: "Clear search" }).click();
    // The seeded conversation is renamed by its first user message.
    await expect(conversation(page, /Summarize the thread from Marcus/)).toHaveCount(1);
  });

  test("renames a conversation from the item menu", async ({ page }) => {
    const menu = await openMenu(page, /Welcome to Orbit/);
    await menu.getByRole("menuitem", { name: "Rename" }).click();

    const input = page.getByRole("textbox", { name: "Conversation title" });
    await input.fill("Launch planning");
    await input.press("Enter");

    await expect(conversation(page, "Launch planning")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Launch planning" })).toBeVisible();
  });

  test("archiving hides a conversation until it is restored", async ({ page }) => {
    const menu = await openMenu(page, /Welcome to Orbit/);
    await menu.getByRole("menuitem", { name: "Archive" }).click();
    await expect(conversation(page, /Welcome to Orbit/)).toHaveCount(0);

    await page.getByTestId("toggle-archived").click();
    await expect(conversation(page, /Welcome to Orbit/)).toHaveCount(1);

    const archivedMenu = await openMenu(page, /Welcome to Orbit/);
    await archivedMenu.getByRole("menuitem", { name: "Restore" }).click();

    await page.getByTestId("toggle-archived").click();
    await expect(conversation(page, /Welcome to Orbit/)).toHaveCount(1);
  });

  test("deleting asks for confirmation and removes the conversation", async ({ page }) => {
    const menu = await openMenu(page, /Welcome to Orbit/);
    await menu.getByRole("menuitem", { name: "Delete" }).click();
    await expect(menu.getByText(/Delete this conversation permanently/)).toBeVisible();

    await menu.getByRole("button", { name: "Cancel" }).click();
    await expect(menu.getByText(/Delete this conversation permanently/)).toHaveCount(0);
    await expect(conversation(page, /Welcome to Orbit/)).toHaveCount(1);

    const confirmed = await openMenu(page, /Welcome to Orbit/);
    await confirmed.getByRole("menuitem", { name: "Delete" }).click();
    await confirmed.getByRole("button", { name: "Delete" }).click();

    await expect(conversation(page, /Welcome to Orbit/)).toHaveCount(0);
  });

  test("the sidebar collapse survives a reload", async ({ page }) => {
    const aside = page.locator("aside").first();
    await expect(aside).toHaveAttribute("data-collapsed", "false");

    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(aside).toHaveAttribute("data-collapsed", "true");
    await expect(page.getByTestId("sidebar-search")).toHaveCount(0);

    await page.reload();
    await expect(page.locator("aside").first()).toHaveAttribute("data-collapsed", "true");
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(page.getByTestId("sidebar-search")).toBeVisible();
  });
});

test.describe("appearance", () => {
  test("the theme toggle switches and persists", async ({ page }) => {
    await resetDemo(page);
    const html = page.locator("html");

    // Until a choice is made the document stays attribute-free and follows the
    // operating system, which the test browser reports as light.
    await expect(html).not.toHaveAttribute("data-theme", /.+/);
    const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await page.getByRole("button", { name: /^Switch to (light|dark) theme$/ }).first().click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    const after = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(after).not.toBe(before);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.getByRole("button", { name: "Switch to light theme" }).first().click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      before,
    );
  });
});

test.describe("message actions", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test.beforeEach(async ({ page }) => {
    await resetDemo(page);
  });

  test("copies an answer to the clipboard", async ({ page }) => {
    await sendPrompt(page, "Check for conflicts");
    await expect(transcript(page).getByText(/Found 1 conflict/)).toBeVisible();

    await page.getByRole("button", { name: "Copy answer" }).last().click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("Found 1 conflict");
  });

  test("feedback is recorded and survives a reload", async ({ page }) => {
    await sendPrompt(page, "Check for conflicts");
    await expect(transcript(page).getByText(/Found 1 conflict/)).toBeVisible();

    const good = page.getByRole("button", { name: "Good response" }).last();
    await expect(good).toHaveAttribute("aria-pressed", "false");
    await good.click();
    await expect(page.getByRole("button", { name: "Good response" }).last()).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.reload();
    await expect(page.getByRole("button", { name: "Good response" }).last()).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("regenerating replaces the answer instead of duplicating it", async ({ page }) => {
    await sendPrompt(page, "Check for conflicts");
    const answer = transcript(page).getByText(/Found 1 conflict/);
    await expect(answer).toHaveCount(1);

    await page.getByRole("button", { name: "Regenerate answer" }).last().click();
    await expect(answer).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Regenerate answer" })).toHaveCount(1);
  });

  test("editing a message confirms the loss and re-runs it", async ({ page }) => {
    await sendPrompt(page, "Check for conflicts");
    await expect(transcript(page).getByText(/Found 1 conflict/)).toBeVisible();

    await page.getByRole("button", { name: "Edit message" }).last().click();
    const dialog = page.getByRole("dialog", { name: "Edit message" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/discards the reply/);

    await dialog.getByRole("button", { name: "Continue" }).click();
    const box = composer(page);
    await expect(box).toHaveValue("Check for conflicts");
    await expect(page.getByText("Editing your message")).toBeVisible();

    await box.fill("What needs my attention?");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(transcript(page).getByText(/messages need attention/)).toBeVisible();
    await expect(transcript(page).getByText(/Found 1 conflict/)).toHaveCount(0);
    await expect(page.getByText("Editing your message")).toHaveCount(0);
  });

  test("jump-to-latest appears only when reading earlier messages", async ({ page }) => {
    for (const prompt of [
      "Check for conflicts",
      "What needs my attention?",
      "Prepare me for my next meeting",
      "List my follow-ups",
    ]) {
      await sendPrompt(page, prompt);
      await expect(composer(page)).toBeEnabled();
    }

    const jump = page.getByRole("button", { name: "Jump to latest message" });
    await expect(jump).toHaveCount(0);

    await transcript(page).evaluate((element) => element.scrollTo({ top: 0 }));
    await expect(jump).toBeVisible();

    await jump.click();
    await expect(jump).toHaveCount(0);
  });
});
