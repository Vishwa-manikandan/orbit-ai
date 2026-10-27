import { expect, test } from "@playwright/test";

/**
 * On a phone the app uses a bottom bar plus a conversation drawer: there is no
 * persistent sidebar. These tests run in the mobile-chromium project only.
 */
test.describe("mobile navigation", () => {
  test("bottom navigation opens every destination", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation");
    await expect(nav).toHaveCount(1);

    await nav.getByRole("link", { name: "Activity", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Execution activity" })).toBeVisible();

    await nav.getByRole("link", { name: /^Approvals/ }).click();
    await expect(page.getByRole("heading", { name: "Approval queue" })).toBeVisible();

    await nav.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Runtime & integrations" })).toBeVisible();
  });

  test("the conversation drawer opens over the workspace", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation").getByRole("button", { name: "Chats" }).click();

    const drawer = page.getByRole("dialog", { name: "Conversations" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId("sidebar-search")).toBeVisible();

    await drawer.getByRole("button", { name: "New conversation" }).click();
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "What can I help with?" })).toBeVisible();
  });

  test("the active item is exposed to assistive technology", async ({ page }) => {
    await page.goto("/activity");
    const nav = page.getByRole("navigation");

    await expect(nav.getByRole("link", { name: "Activity", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator('nav a[aria-current="page"]:visible')).toHaveCount(1);
  });

  test("the desktop sidebar stays out of reach on a phone viewport", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("aside").first()).toBeHidden();
    await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();
  });

  test("unknown routes keep the mobile shell usable", async ({ page }) => {
    const response = await page.goto("/missing-on-mobile");
    expect(response?.status()).toBe(404);

    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to workspace" })).toBeVisible();
    await expect(page.getByRole("navigation")).toBeVisible();
  });
});
