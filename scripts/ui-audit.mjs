import { chromium } from "@playwright/test";

const BASE = process.env.AUDIT_URL ?? "http://localhost:3077";
const ROUTES = ["/", "/activity", "/approvals", "/settings"];
const VIEWPORTS = [
  [320, 740], [375, 812], [430, 932], [768, 1024],
  [1024, 768], [1280, 800], [1440, 900], [1920, 1080],
];

const browser = await chromium.launch();
const findings = [];

for (const [width, height] of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(400);

    // 1. Horizontal overflow
    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      return { scrollW: de.scrollWidth, clientW: de.clientWidth };
    });
    if (overflow.scrollW > overflow.clientW + 1) {
      findings.push(`OVERFLOW ${width}x${height} ${route}: scrollW=${overflow.scrollW} clientW=${overflow.clientW}`);
    }

    // 2. Interactive elements with small effective tap area (rounded to nearest box)
    const small = await page.evaluate(() => {
      const out = [];
      const nodes = document.querySelectorAll('button, a[href], input, textarea, select, [role="button"]');
      for (const el of nodes) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue; // hidden
        if (r.width < 32 || r.height < 32) {
          const label = (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40);
          out.push(`${el.tagName.toLowerCase()} "${label}" ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return out;
    });
    for (const s of small) findings.push(`SMALL-TARGET ${width}x${height} ${route}: ${s}`);
  }
  await context.close();
}

/** Durations under 50ms count as effectively stopped (0.01ms is the usual form). */
const stillAnimated = (value) => {
  const ms = value.endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
  return ms > 50;
};

// 3. Reduced motion
const rm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
const rmp = await rm.newPage();
await rmp.goto(BASE + "/", { waitUntil: "networkidle" }).catch(() => {});
const typingAnim = await rmp.evaluate(() => {
  const dot = document.querySelector(".typing-dot");
  if (!dot) return null;
  return getComputedStyle(dot).animationDuration;
});
if (typingAnim !== null && stillAnimated(typingAnim)) {
  findings.push(`REDUCED-MOTION: .typing-dot animation still active (duration=${typingAnim}) under prefers-reduced-motion`);
}
// check body pulse elements
const pulseAnim = await rmp.evaluate(() => {
  const el = document.querySelector(".animate-pulse, .animate-pulse-soft");
  if (!el) return null;
  return getComputedStyle(el).animationDuration;
});
if (pulseAnim !== null && stillAnimated(pulseAnim)) {
  findings.push(`REDUCED-MOTION: pulse animation still active (duration=${pulseAnim}) under prefers-reduced-motion`);
}
await rm.close();
await browser.close();

console.log(findings.length ? findings.join("\n") : "No findings.");