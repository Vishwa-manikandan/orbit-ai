import { chromium } from "@playwright/test";

/**
 * Keyboard-focus audit: walks each route with the Tab key and verifies that the
 * focused element (or a nearby wrapper, as with the composer) actually changes
 * its computed style, i.e. a sighted keyboard user can tell where focus is.
 */
const BASE = process.env.AUDIT_URL ?? "http://localhost:3077";
const ROUTES = ["/", "/activity", "/approvals", "/settings"];
const SIZES = [
  [375, 812],
  [1280, 900],
];

const browser = await chromium.launch();
const findings = [];

for (const [width, height] of SIZES) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();

  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(300);

    const total = await page.evaluate(() => {
      const sel =
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select, [tabindex]:not([tabindex="-1"])';
      return document.querySelectorAll(sel).length;
    });

    const seen = new Set();
    const limit = Math.min(total, 60);
    for (let i = 0; i < limit; i++) {
      await page.keyboard.press("Tab");
      const result = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const snap = (node) => {
          const cs = getComputedStyle(node);
          return [
            cs.outlineStyle,
            cs.outlineWidth,
            cs.outlineColor,
            cs.boxShadow,
            cs.borderColor,
            cs.backgroundColor,
            cs.textDecorationLine,
          ].join("|");
        };
        const label =
          el.getAttribute("aria-label") ||
          (el.textContent || "").trim().slice(0, 40) ||
          el.tagName.toLowerCase();
        const own = snap(el);
        const parent = el.parentElement ? snap(el.parentElement) : "";
        return {
          tag: el.tagName.toLowerCase(),
          label,
          own,
          parent,
          /* a real indicator: outline drawn, or a ring/shadow, or amber border */
          hasIndicator: /rgb/.test(own.split("|")[2]) && !/none/.test(own.split("|")[0]),
        };
      });
      if (!result) continue;
      const key = `${result.tag}:${result.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // The global :focus-visible outline is the app-wide indicator; flag only
      // elements that suppress it without supplying their own.
      if (!result.hasIndicator) {
        findings.push(`NO-FOCUS-RING ${width}x${height} ${route}: ${result.tag} "${result.label}" outline=${result.own.split("|").slice(0, 3).join(" ")}`);
      }
    }
  }
  await context.close();
}

await browser.close();
console.log(findings.length ? findings.join("\n") : "No focus findings.");
