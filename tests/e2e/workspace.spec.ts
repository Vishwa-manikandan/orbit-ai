import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await page.waitForURL("/");
  await page.close();
});

test("answers a triage request with visible tool traces", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome to Orbit" })).toBeVisible();

  await page.getByRole("textbox", { name: "Message Orbit" }).fill("What needs my attention?");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("3 messages need attention:", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Q3 launch timeline — from Sarah Chen").first()).toBeVisible();
  await expect(
    page.getByText("Search email → Summarize thread → Summarize thread").first(),
  ).toBeVisible();

  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Execution activity" })).toBeVisible();
  await expect(page.getByText("What needs my attention?").first()).toBeVisible();
  await expect(page.getByText("100%")).toBeVisible();
});

test("pauses a send for approval, then executes it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Message Orbit" }).fill("Send it");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("Approve & execute")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("APPROVAL REQUIRED")).toBeVisible();
  await expect(
    page.getByText("Hi Sarah, Quick update: we're still on track for Thursday.").first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Approve & execute" }).click();

  await expect(
    page.getByText("Sent Re: Q3 launch timeline to sarah@northwindlabs.com.").first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Approved by Alex").first()).toBeVisible();

  await page.locator("aside").getByRole("link", { name: "Approvals" }).click();
  await expect(page.getByRole("heading", { name: "Approval queue" })).toBeVisible();
  await expect(page.getByText("Send reply to Sarah Chen").first()).toBeVisible();
  await expect(page.getByText("Approved").first()).toBeVisible();
});
