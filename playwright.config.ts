import { defineConfig, devices } from "@playwright/test";

/**
 * Orbit needs two processes: the Convex backend (localhost:3210) and Next.js.
 * `convex dev --start` boots both in one supervised process, so the app never
 * starts before the backend has pushed functions and written .env.local.
 *
 * Required once per machine:
 *   npx playwright install chromium
 */
const port = process.env.PLAYWRIGHT_PORT ?? "3077";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;
const isCI = Boolean(process.env.CI);

/** Optional: run against a locally installed Chrome instead of bundled Chromium. */
const channel = process.env.PLAYWRIGHT_CHANNEL;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",

  // The suite shares one local demo database, so runs stay serial.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,

  timeout: 60_000,
  expect: { timeout: 15_000 },

  outputDir: "test-results",
  reporter: isCI
    ? [
        ["list"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
        ["junit", { outputFile: "test-results/junit.xml" }],
      ]
    : [
        ["list"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
      ],

  use: {
    baseURL,
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Failure diagnostics: screenshot + trace + recording for every failed test.
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "desktop-chromium",
      // Mobile-only specs exercise the bottom bar, which is hidden on desktop.
      testIgnore: /navigation-mobile\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        ...(channel ? { channel } : {}),
      },
    },
    {
      name: "mobile-chromium",
      // Regression specs target sidebar/context-rail controls that are hidden
      // below lg/xl, so mobile runs the shell smoke suite plus its own
      // bottom-navigation regression suite.
      testMatch: ["**/smoke.spec.ts", "**/navigation-mobile.spec.ts"],
      use: {
        ...devices["Pixel 7"],
        ...(channel ? { channel } : {}),
      },
    },
  ],

  // Skip process management when pointing at an already-running deployment.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `npx convex dev --tail-logs disable --start "npm run dev -- -p ${port}"`,
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          NEXT_PUBLIC_CONVEX_URL:
            process.env.NEXT_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210",
        },
      },
});
