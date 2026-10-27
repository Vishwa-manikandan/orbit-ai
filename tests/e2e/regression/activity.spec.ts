import { expect, test } from "@playwright/test";
import { requestDraftSend, resetDemo, sendPrompt } from "../helpers/demo";

test.describe("activity and trace controls", () => {
  test("shows the empty state after a demo reset", async ({ page }) => {
    await resetDemo(page);
    await page.goto("/activity");

    await expect(page.getByRole("heading", { name: "Execution activity" })).toBeVisible();
    await expect(page.getByText("No runs in this view")).toBeVisible();
  });

  test("filters runs by status", async ({ page }) => {
    await resetDemo(page);
    await sendPrompt(page, "What needs my attention?");
    await expect(
      page.getByTestId("chat-transcript").getByText("3 messages need attention:", { exact: true }),
    ).toBeVisible();

    await page.goto("/activity");
    await expect(page.getByRole("button", { name: /^All/ })).toContainText("1");

    await page.getByRole("button", { name: /^Completed/ }).click();
    await expect(page.getByText("What needs my attention?").first()).toBeVisible();

    await page.getByRole("button", { name: /^Failed/ }).click();
    await expect(page.getByText("No runs in this view")).toBeVisible();

    await page.getByRole("button", { name: /^Awaiting/ }).click();
    await expect(page.getByText("No runs in this view")).toBeVisible();
  });

  test("awaiting filter surfaces a paused run", async ({ page }) => {
    await resetDemo(page);
    await requestDraftSend(page);

    await page.goto("/activity");
    await expect(page.getByRole("button", { name: /^Awaiting/ })).toContainText("1");

    await page.getByRole("button", { name: /^Awaiting/ }).click();
    await expect(page.getByText("Awaiting approval").first()).toBeVisible();
    await expect(page.getByText("Send it").first()).toBeVisible();
  });

  test("expands a run, reveals tool payloads, and opens the conversation", async ({ page }) => {
    await resetDemo(page);
    await sendPrompt(page, "What needs my attention?");
    await expect(
      page.getByTestId("chat-transcript").getByText("3 messages need attention:", { exact: true }),
    ).toBeVisible();

    await page.goto("/activity");
    await page
      .getByTestId("run-row")
      .and(page.getByRole("button", { name: /What needs my attention\?/, expanded: false }))
      .click();

    await expect(page.getByText("Plan", { exact: true })).toBeVisible();
    await expect(page.getByText("Search email").first()).toBeVisible();
    await expect(page.getByText("Outcome", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Collapse run" }).click();
    await expect(page.getByText("Plan", { exact: true })).toBeHidden();

    await page
      .getByTestId("run-row")
      .and(page.getByRole("button", { name: /What needs my attention\?/, expanded: false }))
      .click();
    await page.getByText("ARGS + RESULT").first().click();
    await expect(
      page.locator("pre").filter({ hasText: "needsAttention" }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Open conversation" }).click();
    await expect(page).toHaveURL(/\/$/);
    // The first user message in the seeded thread becomes its title.
    await expect(page.getByRole("heading", { name: "What needs my attention?" })).toBeVisible();
  });
});
