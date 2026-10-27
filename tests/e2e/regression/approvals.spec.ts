import { expect, test } from "@playwright/test";
import { composer, requestDraftSend, resetDemo } from "../helpers/demo";

test.describe("approval controls", () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page);
  });

  test("previews the exact outbound message and sends nothing yet", async ({ page }) => {
    await requestDraftSend(page);

    const card = page.getByTestId("approval-card");
    await expect(card).toContainText("Send reply to Sarah Chen");
    await expect(card).toContainText("Re: Q3 launch timeline");
    await expect(card).toContainText(/Quick update: we're still on track for Thursday/);
    await expect(card.getByRole("button", { name: "Approve & execute" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Decline" })).toBeVisible();
    await expect(
      page.getByTestId("chat-transcript").getByText(/Sent Re: Q3 launch timeline/),
    ).toHaveCount(0);
  });

  test("approving executes the send exactly once and records the decision", async ({ page }) => {
    await requestDraftSend(page);
    await page.getByRole("button", { name: "Approve & execute" }).click();

    await expect(
      page
        .getByTestId("chat-transcript")
        .getByText("Sent Re: Q3 launch timeline to sarah@northwindlabs.com."),
    ).toBeVisible();
    await expect(page.getByTestId("approval-card").getByText("Approved by Alex")).toBeVisible();

    await page.goto("/approvals");
    await expect(page.getByText("All clear")).toBeVisible();
    await expect(page.getByText("Approved").first()).toBeVisible();
  });

  test("declining cancels the run and leaves the draft untouched", async ({ page }) => {
    await requestDraftSend(page);
    await page.getByRole("button", { name: "Decline" }).click();

    await expect(
      page.getByTestId("chat-transcript").getByText(/No changes were made/),
    ).toBeVisible();
    await expect(page.getByText("Declined by Alex").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Send it", exact: true })).toBeVisible();

    const decided = page.getByTestId("approval-card").first();
    await decided.getByText("VIEW DECLINED MESSAGE").click();
    await expect(decided.locator("pre")).toBeVisible();

    await page.goto("/approvals");
    await expect(page.getByText("Declined").first()).toBeVisible();
  });

  test("blocks the composer while an approval is pending", async ({ page }) => {
    await requestDraftSend(page);

    await expect(composer(page)).toBeDisabled();
    await expect(composer(page)).toHaveAttribute("placeholder", /Approve or decline/);

    await page.getByRole("button", { name: "Decline" }).click();
    await expect(composer(page)).toBeEnabled();
    await expect(composer(page)).toHaveAttribute("placeholder", /Ask Orbit/);
  });

  test("approves from the approval queue and returns to the conversation", async ({ page }) => {
    await requestDraftSend(page);
    await page.goto("/approvals");

    await expect(page.getByRole("heading", { name: "Approval queue" })).toBeVisible();
    await expect(page.getByText("1 pending")).toBeVisible();

    await page.getByRole("button", { name: "Approve & execute" }).click();
    await expect(page.getByText("Nothing waiting")).toBeVisible();
    await expect(page.getByText("Approved").first()).toBeVisible();

    await page.getByTitle("Open conversation").click();
    await expect(page).toHaveURL(/\/$/);
    // The first user message renames the seeded thread to the prompt.
    await expect(page.getByRole("heading", { name: "Send it" })).toBeVisible();
    await expect(composer(page)).toBeVisible();
  });

  test("queue exposes its policy link and read-only demo status", async ({ page }) => {
    await page.goto("/approvals");

    await expect(page.getByRole("button", { name: /Demo workspace/ })).toBeDisabled();
    await page.getByRole("link", { name: /View the tool registry/ }).click();
    await expect(page).toHaveURL(/\/settings$/);
  });
});
