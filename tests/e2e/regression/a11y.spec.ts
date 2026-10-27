import { expect, test } from "@playwright/test";

/**
 * Accessibility invariants verified against the live UI rather than by reading
 * CSS: the reduced-motion contract, the WCAG 2.2 AA target-size floor, and the
 * presence of a visible keyboard focus indicator.
 */

/** Computed animation durations arrive as "2s" or "0.01ms". */
function toSeconds(value: string): number {
  const n = Number.parseFloat(value);
  return value.endsWith("ms") ? n / 1000 : n;
}

test.describe("accessibility invariants", () => {
  test("stops decorative loops when the OS requests reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/activity");

    const live = page.locator(".animate-pulse-soft").first();
    await expect(live).toBeVisible();

    // Baseline: the loop genuinely runs when motion is allowed.
    const running = await live.evaluate((el) => getComputedStyle(el).animationDuration);
    expect(toSeconds(running)).toBeGreaterThan(0.5);

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await live.evaluate((el) => {
      const style = getComputedStyle(el);
      return { duration: style.animationDuration, iterations: style.animationIterationCount };
    });

    expect(toSeconds(reduced.duration)).toBeLessThanOrEqual(0.05);
    expect(reduced.iterations).toBe("1");
  });

  test("keeps every interactive control at least 24px in both axes", async ({ page }) => {
    const routes = ["/", "/activity", "/approvals", "/settings"];
    const viewports = [
      { width: 375, height: 812 },
      { width: 1280, height: 800 },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const route of routes) {
        await page.goto(route);

        const violations = await page.evaluate(() => {
          const selector = 'button, a[href], textarea, input, select, [role="button"]';
          const found: { label: string; width: number; height: number }[] = [];

          for (const node of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            const hidden =
              rect.width === 0 ||
              rect.height === 0 ||
              style.visibility === "hidden" ||
              style.display === "none";
            if (hidden) continue;

            // WCAG 2.2 AA 2.5.8 (Target Size, Minimum): 24×24 CSS pixels.
            if (rect.width < 24 || rect.height < 24) {
              found.push({
                label: (node.getAttribute("aria-label") || node.textContent || node.tagName)
                  .trim()
                  .slice(0, 40),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              });
            }
          }

          return found;
        });

        expect(
          violations,
          `${viewport.width}px ${route}: ${JSON.stringify(violations)}`,
        ).toEqual([]);
      }
    }
  });

  test("draws a visible focus indicator on every keyboard stop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    for (let step = 1; step <= 8; step++) {
      await page.keyboard.press("Tab");

      const indicator = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        const shadow = style.boxShadow;
        const ringShadow =
          shadow !== "none" && /rgba?\([^)]*\)\s+\d+px/.test(shadow) && !/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px$/.test(shadow);
        return {
          outline: style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 2,
          ringShadow,
        };
      });

      if (!indicator) continue;
      expect(
        indicator.outline || indicator.ringShadow,
        `no focus indicator after Tab #${step}`,
      ).toBe(true);
    }
  });
});
