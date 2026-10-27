import { expect, test } from "@playwright/test";

/**
 * Read-only smoke coverage. Runs on every project (desktop + mobile) and never
 * mutates demo data, so it is safe to run before the stateful workflow suite.
 */
test.describe("application smoke", () => {
  test("loads the workspace shell without a boot error", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    const response = await page.goto("/");
    expect(response?.ok()).toBeTruthy();

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message Orbit" })).toBeVisible();
    await expect(page.getByText(/couldn.t start/i)).toHaveCount(0);

    expect(pageErrors, pageErrors.map((error) => error.message).join("\n")).toHaveLength(0);
  });

  test("navigates the primary routes", async ({ page }) => {
    await page.goto("/");

    const nav = page.getByRole("navigation").first();
    await nav.getByRole("link", { name: "Activity", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Execution activity" })).toBeVisible();

    await nav.getByRole("link", { name: /^Approvals/ }).click();
    await expect(page.getByRole("heading", { name: "Approval queue" })).toBeVisible();

    await page.goto("/");
    await expect(page.getByRole("textbox", { name: "Message Orbit" })).toBeVisible();
  });

  test("uses the layout appropriate to the viewport", async ({ page, isMobile }) => {
    await page.goto("/");

    if (isMobile) {
      await expect(page.getByRole("navigation")).toHaveCount(1);
      await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
    } else {
      await expect(page.locator("aside").first()).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Search conversations" })).toBeVisible();
    }
  });
});
