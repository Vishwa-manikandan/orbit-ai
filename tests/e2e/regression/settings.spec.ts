import { expect, test } from "@playwright/test";
import { resetDemo, sendPrompt } from "../helpers/demo";

test.describe("settings controls", () => {
  test("documents the typed tool registry and approval policy", async ({ page }) => {
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: "Runtime & integrations" })).toBeVisible();
    await expect(page.getByText("9 TOOLS")).toBeVisible();
    await expect(page.getByText("Send email").first()).toBeVisible();
    await expect(page.getByText("Approval", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Auto", { exact: true })).toHaveCount(8);
  });

  test("cancels a demo reset when focus leaves the control", async ({ page }) => {
    await page.goto("/settings");

    await page.getByRole("button", { name: "Reset demo data" }).click();
    await expect(page.getByRole("button", { name: "Confirm reset" })).toBeVisible();

    await page.getByRole("heading", { name: "Runtime & integrations" }).click();
    await expect(page.getByRole("button", { name: "Reset demo data" })).toBeVisible();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("resets demo data only after confirmation", async ({ page }) => {
    await resetDemo(page);
    await sendPrompt(page, "What needs my attention?");
    await expect(
      page.getByTestId("chat-transcript").getByText("3 messages need attention:", { exact: true }),
    ).toBeVisible();

    await page.goto("/settings");
    await page.getByRole("button", { name: "Reset demo data" }).click();
    await page.getByRole("button", { name: "Confirm reset" }).click();

    await page.waitForURL((url) => url.pathname === "/");
    await page.goto("/activity");
    await expect(page.getByText("No runs in this view")).toBeVisible();
  });
});
