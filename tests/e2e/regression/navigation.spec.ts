import { expect, test, type Page } from "@playwright/test";

/**
 * Orbit exposes exactly four routes. Keep this table in sync with app/.
 */
const routes = ["/", "/activity", "/approvals", "/settings"] as const;

async function expectDestination(page: Page, path: (typeof routes)[number]) {
  await expect(page).toHaveURL(path === "/" ? /\/$/ : new RegExp(`${path}$`));

  switch (path) {
    case "/":
      await expect(page.getByRole("textbox", { name: "Message Orbit" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      break;
    case "/activity":
      await expect(page.getByRole("heading", { name: "Execution activity" })).toBeVisible();
      break;
    case "/approvals":
      await expect(page.getByRole("heading", { name: "Approval queue" })).toBeVisible();
      break;
    case "/settings":
      await expect(page.getByRole("heading", { name: "Runtime & integrations" })).toBeVisible();
      break;
  }

  // Next's dev error overlay never belongs on a healthy route.
  await expect(page.locator("#nextjs__container_errors_desc")).toHaveCount(0);
}

test.describe("navigation regression", () => {
  test("every internal link targets a real, non-placeholder route", async ({ page }) => {
    for (const path of routes) {
      await page.goto(path);
      const hrefs = await page
        .locator("a[href]")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));

      expect(hrefs.length).toBeGreaterThan(0);

      for (const href of hrefs) {
        expect(href).not.toBe("");
        expect(href).not.toBe("#");
        expect(href.startsWith("javascript:")).toBe(false);
        expect(routes).toContain(href as (typeof routes)[number]);
      }
    }
  });

  test("sidebar links open their destination pages", async ({ page }) => {
    for (const path of ["/activity", "/approvals"] as const) {
      await page.goto("/");
      await page.locator(`nav a[href="${path}"]:visible`).first().click();
      await expectDestination(page, path);
    }

    // Runtime settings live in the sidebar footer, outside the primary nav.
    await page.goto("/");
    await page.locator('aside a[href="/settings"]:visible').first().click();
    await expectDestination(page, "/settings");

    await page.goto("/activity");
    await page.locator('aside a[aria-label="Orbit AI workspace"]:visible').first().click();
    await expectDestination(page, "/");
  });

  test("header links open approvals and activity", async ({ page }) => {
    await page.goto("/");
    const header = page.locator("header");

    await header.getByRole("link", { name: /^Approvals/ }).click();
    await expectDestination(page, "/approvals");

    await page.goto("/");
    await header.getByRole("link", { name: "Execution activity" }).click();
    await expectDestination(page, "/activity");
  });

  test("browser back and forward restore pages and content", async ({ page }) => {
    await page.goto("/");
    await page.locator('nav a[href="/activity"]:visible').first().click();
    await expectDestination(page, "/activity");

    await page.locator('nav a[href="/approvals"]:visible').first().click();
    await expectDestination(page, "/approvals");

    await page.goBack();
    await expectDestination(page, "/activity");

    await page.goBack();
    await expectDestination(page, "/");

    await page.goForward();
    await expectDestination(page, "/activity");
  });

  test("refreshing a valid route keeps the page healthy", async ({ page }) => {
    for (const path of routes) {
      await page.goto(path);
      const response = await page.reload();
      expect(response?.status()).toBe(200);
      await expectDestination(page, path);
    }
  });

  test("the active navigation item reflects the current route", async ({ page }) => {
    for (const path of ["/activity", "/approvals", "/settings"] as const) {
      await page.goto(path);
      const current = page.locator('nav a[aria-current="page"]:visible');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAttribute("href", path);

      await expect(
        page.locator(`nav a[aria-current="page"]:not([href="${path}"])`),
      ).toHaveCount(0);
    }
  });

  test("unknown routes render the not-found experience", async ({ page }) => {
    const response = await page.goto("/this-route-does-not-exist");
    expect(response?.status()).toBe(404);

    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByText("Error 404")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to workspace" })).toBeVisible();

    await page.getByRole("link", { name: "Back to workspace" }).click();
    await expectDestination(page, "/");
  });

  test("a nested unknown route keeps the app shell usable", async ({ page }) => {
    const response = await page.goto("/activity/does-not-exist");
    expect(response?.status()).toBe(404);

    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("navigation")).toBeVisible();

    await page.getByRole("navigation").getByRole("link", { name: "Activity", exact: true }).click();
    await expectDestination(page, "/activity");
  });

  test("navigation works with the keyboard", async ({ page }) => {
    await page.goto("/");

    // First Tab reaches the brand link, which is the first focusable element.
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      text: document.activeElement?.textContent?.trim() ?? "",
    }));
    expect(focused.tag).toBe("A");
    expect(focused.text).toContain("Orbit");

    await page
      .getByRole("navigation")
      .getByRole("link", { name: "Activity", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expectDestination(page, "/activity");
  });
});
