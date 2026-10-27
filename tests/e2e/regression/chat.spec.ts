import { expect, type Page } from "@playwright/test";
import { test } from "@playwright/test";
import { composer, resetDemo, sendPrompt } from "../helpers/demo";

async function newConversation(page: Page) {
  await page
    .locator("aside")
    .getByRole("button", { name: /New conversation/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "What can I help with?" })).toBeVisible();
}

test.describe("chat interactions", () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page);
  });

  test("a new conversation offers the four example prompts", async ({ page }) => {
    await newConversation(page);

    for (const label of [
      "Triage my inbox",
      "Prep my next meeting",
      "Draft a reply",
      "Check for conflicts",
    ]) {
      await expect(page.getByRole("button", { name: new RegExp(label) })).toBeVisible();
    }
  });

  test("an example prompt runs the matching request", async ({ page }) => {
    await newConversation(page);
    await page.getByRole("button", { name: /Check for conflicts/ }).click();

    const transcript = page.getByTestId("chat-transcript");
    await expect(transcript.getByText(/Found 1 conflict/)).toBeVisible();
    await expect(transcript.getByText(/Q3 launch planning/)).toBeVisible();
    await expect(transcript.getByText(/Deep work/)).toBeVisible();
    // The welcome screen is replaced by the conversation.
    await expect(page.getByRole("heading", { name: "What can I help with?" })).toHaveCount(0);
  });

  test("tool trace expands with arguments and result payloads", async ({ page }) => {
    await sendPrompt(page, "Check for conflicts");
    const transcript = page.getByTestId("chat-transcript");
    await expect(transcript.getByText(/Found 1 conflict/)).toBeVisible();

    const trace = page.getByRole("button", { name: /Trace/ }).last();
    await expect(page.getByText("planner: rules")).toHaveCount(0);

    await trace.click();
    await expect(page.getByText("planner: rules")).toBeVisible();

    await page.getByText("arguments", { exact: true }).click();
    await expect(page.locator("pre").filter({ hasText: '"days"' })).toBeVisible();

    await page.getByText("result", { exact: true }).click();
    await expect(page.locator("pre").filter({ hasText: "conflicts" }).first()).toBeVisible();
  });

  test("drafting a reply reports the draft and shows the tool step", async ({ page }) => {
    await sendPrompt(page, "Draft a reply to Sarah saying I'll share the launch deck tomorrow");

    const transcript = page.getByTestId("chat-transcript");
    await expect(transcript.getByText(/Drafted a reply to Sarah Chen/)).toBeVisible();
    await expect(transcript.getByText(/Draft reply/).first()).toBeVisible();
  });

  test("preparing a meeting renders a markdown brief", async ({ page }) => {
    await sendPrompt(page, "Prepare me for my next meeting");

    const transcript = page.getByTestId("chat-transcript");
    await expect(transcript.getByRole("heading", { name: /Design review/ })).toBeVisible();
    await expect(transcript.getByText("Suggested agenda:")).toBeVisible();
  });

  test("Enter submits and Shift+Enter preserves a newline", async ({ page }) => {
    const box = composer(page);
    await box.fill("First line");
    await box.press("Shift+Enter");
    await box.type("Second line");

    await expect(box).toHaveValue("First line\nSecond line");

    await box.press("Enter");

    // Submission is observable through the thread title and the assistant reply.
    await expect(page.getByRole("heading", { name: "First line Second line" })).toBeVisible();
    await expect(box).toHaveValue("");
    await expect(
      page.getByTestId("chat-transcript").getByText(/I can work across your inbox/),
    ).toBeVisible();
    // With no provider configured the reply states that limitation instead of
    // implying the open-ended request was understood.
    await expect(
      page.getByTestId("chat-transcript").getByText(/No language model is configured/),
    ).toBeVisible();
  });

  test("send is disabled for empty input and rejects overlong messages", async ({ page }) => {
    const send = page.getByRole("button", { name: "Send message" });
    await expect(send).toBeDisabled();

    await composer(page).fill("x".repeat(4001));
    await expect(page.getByText(/1 over the limit/)).toBeVisible();
    await expect(send).toBeEnabled();
    await send.click();

    // Scoped to the composer banner: the Next.js dev overlay echoes the same
    // server-side validation message, which would otherwise duplicate the match.
    const banner = page.locator("p").filter({ hasText: "Message is too long" });
    await expect(banner).toBeVisible();
    expect((await composer(page).inputValue()).length).toBe(4001);

    await page.getByRole("button", { name: "Dismiss error" }).click();
    await expect(banner).toHaveCount(0);
  });

  test("creates a conversation and switches back to the seeded thread", async ({ page }) => {
    await newConversation(page);

    await sendPrompt(page, "Summarize the thread from Marcus");
    await expect(page.getByText(/Pricing page copy/).first()).toBeVisible();

    const aside = page.locator("aside").first();
    await expect(
      aside.getByTestId("conversation-item").filter({ hasText: "Summarize the thread from Marcus" }),
    ).toBeVisible();

    await aside
      .getByTestId("conversation-item")
      .filter({ hasText: "Welcome to Orbit" })
      .click();
    await expect(page.getByRole("heading", { name: "Welcome to Orbit" })).toBeVisible();
  });

  test("creates a follow-up task and reports it in the answer", async ({ page }) => {
    await sendPrompt(page, "Add a follow-up with Marcus about the pricing page tomorrow");

    const transcript = page.getByTestId("chat-transcript");
    await expect(transcript.getByText(/Added follow-up/)).toBeVisible();
    await expect(
      transcript.getByText("Marcus about the pricing page", { exact: true }),
    ).toBeVisible();
  });
});
