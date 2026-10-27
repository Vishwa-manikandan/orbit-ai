import { expect, test, type Page } from "@playwright/test";
import { composer, requestDraftSend, resetDemo, sendPrompt } from "../helpers/demo";

const transcript = (page: Page) => page.getByTestId("chat-transcript");
const send = (page: Page) => page.getByRole("button", { name: "Send message" });
const ready = (page: Page) => page.getByText("READY", { exact: true });
const typingBubble = (page: Page) => page.locator(".typing-dot");
const banner = (page: Page) => page.locator('p:has(+ button[aria-label="Dismiss error"])');

test.describe("agent workflow regressions", () => {
  test.beforeEach(async ({ page }) => {
    await resetDemo(page);
  });

  test("submits a typed message once, renders the reply, and clears the composer", async ({
    page,
  }) => {
    const prompt = "Do I have any conflicts tomorrow?";
    const box = composer(page);
    await box.click();
    await box.type(prompt);
    await box.press("Enter");

    // The first user message renames the seeded thread.
    await expect(page.getByRole("heading", { name: prompt })).toBeVisible();
    await expect(transcript(page).getByText("Found 1 conflict")).toBeVisible();
    await expect(transcript(page).getByText(prompt, { exact: true })).toHaveCount(1);
    await expect(box).toHaveValue("");
    await expect(ready(page)).toBeVisible();
  });

  test("shows an in-flight progress state and clears it after completion", async ({ page }) => {
    // Convex actions ride the shared WebSocket, so a local run can finish in
    // under a frame. Record every busy state the UI renders instead of polling
    // for a window that may close before the next assertion.
    await page.evaluate(() => {
      const w = window as unknown as {
        __orbitBusy: { executing: boolean; typing: boolean; composerDisabled: boolean };
      };
      w.__orbitBusy = { executing: false, typing: false, composerDisabled: false };
      const record = () => {
        const text = document.body.innerText;
        if (text.includes("EXECUTING")) w.__orbitBusy.executing = true;
        // The typing bubble labels itself with the run's current activity once
        // the planner reports one ("Planning the request…"), so detect the
        // bubble's dots rather than the no-activity "working" fallback text.
        if (document.querySelector(".typing-dot")) w.__orbitBusy.typing = true;
        const box = document.querySelector('textarea[aria-label="Message Orbit"]');
        if (box instanceof HTMLTextAreaElement && box.disabled) {
          w.__orbitBusy.composerDisabled = true;
        }
      };
      new MutationObserver(record).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      record();
    });

    await sendPrompt(page, "What needs my attention?");

    // The run completes and the deterministic reply renders.
    await expect(
      transcript(page).getByText("3 messages need attention:", { exact: true }),
    ).toBeVisible();
    await expect(ready(page)).toBeVisible();

    // While in flight the UI showed the EXECUTING footer, the typing bubble,
    // and a disabled composer.
    const busy = await page.evaluate(
      () =>
        (
          window as unknown as {
            __orbitBusy: { executing: boolean; typing: boolean; composerDisabled: boolean };
          }
        ).__orbitBusy,
    );
    expect(busy).toEqual({ executing: true, typing: true, composerDisabled: true });

    // Loading indicators stop once the run completes.
    await expect(composer(page)).toBeEnabled();
    await expect(typingBubble(page)).toHaveCount(0);
    await expect(page.getByText("EXECUTING", { exact: true })).toHaveCount(0);
    await expect(
      transcript(page).getByText("What needs my attention?", { exact: true }),
    ).toHaveCount(1);
  });

  test("a mid-session connection drop neither loses nor duplicates a submission", async ({
    page,
  }) => {
    const network = await page.context().newCDPSession(page);
    await network.send("Network.enable");
    const setOffline = (offline: boolean) =>
      network.send("Network.emulateNetworkConditions", {
        offline,
        latency: 0,
        downloadThroughput: offline ? 0 : -1,
        uploadThroughput: offline ? 0 : -1,
      });

    // The composer stays responsive while the backend is unreachable.
    await setOffline(true);
    await composer(page).fill("Check for conflicts");
    await expect(send(page)).toBeEnabled();
    await send(page).click();
    await expect(composer(page)).toBeDisabled();

    // On reconnect the queued request runs exactly once and the UI recovers.
    await setOffline(false);
    await expect(ready(page)).toBeVisible();
    await expect(composer(page)).toBeEnabled();
    await expect(banner(page)).toHaveCount(0);
    await expect(transcript(page).getByText("Found 1 conflict")).toBeVisible();
    await expect(transcript(page).getByText("Check for conflicts", { exact: true })).toHaveCount(
      1,
    );
  });

  test("rapid repeated submits create exactly one message", async ({ page }) => {
    await composer(page).fill("Show my tasks");
    await send(page).evaluate((button) => {
      for (let i = 0; i < 3; i += 1) (button as HTMLButtonElement).click();
    });

    await expect(ready(page)).toBeVisible();
    // No duplicate submission error surfaces, and only one message is stored.
    await expect(banner(page)).toHaveCount(0);
    await expect(transcript(page).getByText("Show my tasks", { exact: true })).toHaveCount(1);
    await expect(transcript(page).getByRole("button", { name: /Trace/ })).toBeVisible();
  });

  test("reports every tool step with status, arguments, and results", async ({ page }) => {
    await sendPrompt(page, "What needs my attention?");
    await expect(
      transcript(page).getByText("3 messages need attention:", { exact: true }),
    ).toBeVisible();

    const trace = transcript(page).getByRole("button", { name: /Trace/ });
    await expect(trace).toContainText("3 steps");
    await trace.click();

    await expect(transcript(page).getByText("planner: rules")).toBeVisible();
    await expect(transcript(page).getByText("email.searchThreads")).toHaveCount(1);
    await expect(transcript(page).getByText("email.summarizeThread")).toHaveCount(2);

    await transcript(page).getByText("arguments", { exact: true }).first().click();
    await expect(
      transcript(page).locator("pre").filter({ hasText: "needsAttention" }).first(),
    ).toBeVisible();

    await transcript(page).getByText("result", { exact: true }).first().click();
    await expect(
      transcript(page).locator("pre").filter({ hasText: "Q3 launch timeline" }).first(),
    ).toBeVisible();

    await expect(transcript(page).getByText("Run error")).toHaveCount(0);
    await expect(transcript(page).getByText("run interrupted")).toHaveCount(0);
    await expect(ready(page)).toBeVisible();
  });

  test("preserves the conversation when navigating away and back", async ({ page }) => {
    await sendPrompt(page, "Do I have any conflicts tomorrow?");
    await expect(transcript(page).getByText("Found 1 conflict")).toBeVisible();

    await page.goto("/activity");
    await expect(page.getByRole("heading", { name: "Execution activity" })).toBeVisible();

    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "Do I have any conflicts tomorrow?" }),
    ).toBeVisible();
    await expect(transcript(page).getByText("Found 1 conflict")).toBeVisible();
    await expect(
      transcript(page).getByText("Do I have any conflicts tomorrow?", { exact: true }),
    ).toHaveCount(1);
    await expect(composer(page)).toBeEnabled();
  });

  test("a new conversation clears the view and keeps the old thread intact", async ({ page }) => {
    await sendPrompt(page, "Add a follow-up with Marcus about the pricing page tomorrow");
    await expect(transcript(page).getByText(/Added follow-up/)).toBeVisible();

    await page.locator("aside").first().getByRole("button", { name: /New conversation/ }).click();
    await expect(page.getByRole("heading", { name: "What can I help with?" })).toBeVisible();
    await expect(transcript(page).getByText("Added follow-up")).toHaveCount(0);
    await expect(composer(page)).toBeEnabled();
    await expect(ready(page)).toBeVisible();

    // The new thread runs normally.
    await sendPrompt(page, "Check for conflicts");
    await expect(transcript(page).getByText("Found 1 conflict")).toBeVisible();

    // Switching back shows the persisted original conversation.
    await page
      .locator("aside")
      .first()
      .getByTestId("conversation-item")
      .filter({ hasText: "Add a follow-up with Marcus" })
      .click();
    await expect(page.getByRole("heading", { name: /Add a follow-up with Marcus/ })).toBeVisible();
    await expect(
      transcript(page).getByText("Marcus about the pricing page", { exact: true }),
    ).toBeVisible();
  });

  test("approving a sensitive action executes it exactly once and records it", async ({ page }) => {
    await requestDraftSend(page);
    await expect(composer(page)).toBeDisabled();
    await expect(composer(page)).toHaveAttribute("placeholder", /Approve or decline/);

    await page.getByRole("button", { name: "Approve & execute" }).click();

    const sent = "Sent Re: Q3 launch timeline to sarah@northwindlabs.com.";
    await expect(transcript(page).getByText(sent, { exact: true })).toBeVisible();
    await expect(transcript(page).getByText(sent, { exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Approve & execute" })).toHaveCount(0);
    await expect(composer(page)).toBeEnabled();

    // Persisted results: the queue records the decision and the run completed once.
    await page.goto("/approvals");
    await expect(page.getByText("All clear")).toBeVisible();
    await expect(page.getByText("Approved").first()).toBeVisible();

    await page.goto("/activity");
    await expect(page.getByRole("button", { name: /^Completed/ })).toContainText("1");
    await expect(page.getByRole("button", { name: /^Awaiting/ })).toContainText("0");
  });

  test("declining denies the action with no side effects", async ({ page }) => {
    await requestDraftSend(page);
    await page.getByRole("button", { name: "Decline" }).click();

    await expect(transcript(page).getByText(/No changes were made/)).toBeVisible();
    await expect(transcript(page).getByText(/Sent Re:/)).toHaveCount(0);
    await expect(composer(page)).toBeEnabled();

    await page.goto("/approvals");
    await expect(page.getByText("Declined").first()).toBeVisible();
  });

  test("rejects empty, whitespace-only, and overlong input", async ({ page }) => {
    const sendButton = send(page);
    await expect(sendButton).toBeDisabled();

    await composer(page).fill("   ");
    await expect(sendButton).toBeDisabled();

    await composer(page).fill("x".repeat(4001));
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    const error = page.locator("p").filter({ hasText: "Message is too long" });
    await expect(error).toBeVisible();
    await page.getByRole("button", { name: "Dismiss error" }).click();
    await expect(error).toHaveCount(0);

    await composer(page).fill("Check for conflicts");
    await expect(sendButton).toBeEnabled();
    await sendButton.click();
    await expect(transcript(page).getByText("Found 1 conflict")).toBeVisible();
  });
});
