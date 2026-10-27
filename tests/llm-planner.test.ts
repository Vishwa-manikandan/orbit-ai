import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentError } from "@/convex/lib/errors";
import {
  llmDecision,
  llmDecisionWithRetry,
  llmPlanner,
  type LlmConfig,
} from "@/convex/lib/llmPlanner";
import type { PlannerContext } from "@/convex/lib/types";
import { createMemoryPort, NOW } from "./helpers/memory-port";

const config: LlmConfig = {
  apiKey: "test-key",
  baseUrl: "https://llm.test/v1",
  model: "test-model",
  maxTokens: 1200,
};

function plannerContext(prompt: string): PlannerContext {
  const port = createMemoryPort();
  return {
    now: NOW,
    prompt,
    recentMessages: [{ role: "user", content: "Earlier request" }],
    mail: port.state.mail,
    drafts: port.state.drafts.filter((draft) => draft.status === "draft"),
    events: port.state.events,
    tasks: port.state.tasks,
  };
}

function completion(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetchWith(...responses: (Response | Error)[]) {
  const mock = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) mock.mockRejectedValueOnce(response);
    else mock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("llm planner (mocked provider)", () => {
  it("turns a mocked completion into validated plan steps", async () => {
    const fetchMock = stubFetchWith(
      completion({
        choices: [
          {
            message: {
              content: "Checking your calendar now.",
              tool_calls: [
                {
                  id: "call_1",
                  function: { name: "calendar.findConflicts", arguments: '{"days":3}' },
                },
                {
                  id: "call_2",
                  function: {
                    name: "email.searchThreads",
                    arguments: '{"needsAttention":true,"limit":5}',
                  },
                },
              ],
            },
          },
        ],
      }),
    );

    const plan = await llmPlanner(plannerContext("Any conflicts this week?"), config);

    expect(plan.provider).toBe("llm:test-model");
    expect(plan.note).toBe("Checking your calendar now.");
    expect(plan.steps).toEqual([
      expect.objectContaining({ tool: "calendar.findConflicts", args: { days: 3 } }),
      expect.objectContaining({
        tool: "email.searchThreads",
        args: { needsAttention: true, limit: 5 },
      }),
    ]);

    // The request itself is a deterministic, verifiable fixture.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://llm.test/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(init.body));
    expect(body.temperature).toBe(0);
    // A bounded completion keeps gateway balances usable and output short.
    expect(body.max_tokens).toBe(1200);
    // 9 executable tools + the askUser decision tool.
    expect(body.tools).toHaveLength(10);
    expect(
      body.tools.some((tool: { function: { name: string } }) => tool.function.name === "askUser"),
    ).toBe(true);
  });

  it("flags a tool call whose arguments are not valid JSON", async () => {
    stubFetchWith(
      completion({
        choices: [
          {
            message: {
              tool_calls: [
                { id: "call_1", function: { name: "calendar.findConflicts", arguments: "{days:" } },
              ],
            },
          },
        ],
      }),
    );

    const plan = await llmPlanner(plannerContext("Conflicts?"), config);

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      tool: "calendar.findConflicts",
      args: {},
      rationale: "Model plan (arguments were not valid JSON).",
    });
  });

  it("keeps valid calls and drops the ones that fail schema validation", async () => {
    stubFetchWith(
      completion({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "call_0",
                  function: { name: "email.searchThreads", arguments: '{"limit":3}' },
                },
                {
                  id: "call_1",
                  function: { name: "email.searchThreads", arguments: '{"limit":0}' },
                },
                { id: "call_2", function: { name: "email.deleteEverything", arguments: "{}" } },
              ],
            },
          },
        ],
      }),
    );

    const plan = await llmPlanner(plannerContext("Triage my inbox"), config);

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      tool: "email.searchThreads",
      args: { limit: 3 },
    });
  });

  it("fails instead of silently completing when every planned call is invalid", async () => {
    stubFetchWith(
      completion({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "call_1",
                  function: { name: "email.searchThreads", arguments: '{"limit":0}' },
                },
                { id: "call_2", function: { name: "email.deleteEverything", arguments: "{}" } },
              ],
            },
          },
        ],
      }),
    );

    await expect(llmPlanner(plannerContext("Triage my inbox"), config)).rejects.toMatchObject({
      code: "plan_invalid",
    });
  });

  it("asks for a missing required argument instead of dropping the call", async () => {
    stubFetchWith(
      completion({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "call_1",
                  function: {
                    name: "tasks.createFollowUp",
                    arguments: '{"source":"Marcus Webb"}',
                  },
                },
              ],
            },
          },
        ],
      }),
    );

    const decision = await llmDecision(
      { context: plannerContext("Add a follow-up for Marcus"), observations: [], turn: 1 },
      config,
    );

    expect(decision.kind).toBe("clarify");
    if (decision.kind !== "clarify") return;
    expect(decision.question).toMatch(/title/i);
    expect(decision.options).toEqual([]);
  });

  it("fails on an unknown tool even when its arguments were not JSON", async () => {
    stubFetchWith(
      completion({
        choices: [
          {
            message: {
              tool_calls: [
                { id: "call_1", function: { name: "email.deleteEverything", arguments: "{oops" } },
              ],
            },
          },
        ],
      }),
    );

    await expect(
      llmDecision({ context: plannerContext("Triage my inbox"), observations: [], turn: 1 }, config),
    ).rejects.toMatchObject({ code: "plan_invalid" });
  });

  it("propagates a provider HTTP failure", async () => {
    stubFetchWith(completion({ error: "boom" }, 500));

    await expect(llmPlanner(plannerContext("Hello?"), config)).rejects.toThrow(
      /LLM request failed \(500\)/,
    );
  });

  it("propagates a provider timeout or network failure unchanged", async () => {
    const timeout = new DOMException("The operation timed out.", "TimeoutError");
    stubFetchWith(timeout);

    await expect(llmPlanner(plannerContext("Hello?"), config)).rejects.toBe(timeout);

    const network = new TypeError("fetch failed");
    stubFetchWith(network);

    await expect(llmPlanner(plannerContext("Hello?"), config)).rejects.toBe(network);
  });

  it("throws when the completion contains no choices", async () => {
    stubFetchWith(completion({ choices: [] }));

    await expect(llmPlanner(plannerContext("Hello?"), config)).rejects.toThrow(
      "LLM returned no choices.",
    );
  });

  it("asks a clarifying question through the askUser tool", async () => {
    stubFetchWith(
      completion({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "call_1",
                  function: {
                    name: "askUser",
                    arguments: JSON.stringify({
                      question: "Which thread should I reply to?",
                      options: ["Reply to Sarah Chen", "Reply to Marcus Webb"],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    );

    const decision = await llmDecision(
      { context: plannerContext("Draft a reply"), observations: [], turn: 1 },
      config,
    );

    expect(decision).toMatchObject({
      kind: "clarify",
      question: "Which thread should I reply to?",
      options: ["Reply to Sarah Chen", "Reply to Marcus Webb"],
    });
  });

  it("returns a grounded reply decision when no tool is needed", async () => {
    stubFetchWith(
      completion({
        choices: [{ message: { content: "Your inbox has 2 threads waiting on you." } }],
      }),
    );

    const decision = await llmDecision(
      { context: plannerContext("Anything for me?"), observations: [], turn: 1 },
      config,
    );

    expect(decision).toMatchObject({
      kind: "reply",
      message: "Your inbox has 2 threads waiting on you.",
    });
  });

  it("sends tool results back to the model on the next turn", async () => {
    const fetchMock = stubFetchWith(
      completion({ choices: [{ message: { content: "Sent to sarah@northwindlabs.com." } }] }),
    );

    const decision = await llmDecision(
      {
        context: plannerContext("Did that send?"),
        observations: [
          {
            stepIndex: 0,
            tool: "email.sendDraft",
            args: { draftId: "draft_sarah" },
            ok: true,
            summary: "Sent **Re: Q3 launch timeline** to sarah@northwindlabs.com.",
            data: { receipt: { subject: "Re: Q3 launch timeline" } },
          },
        ],
        turn: 2,
      },
      config,
    );

    expect(decision.kind).toBe("reply");
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    const lastMessage = body.messages[body.messages.length - 1].content as string;
    expect(lastMessage).toContain("Tool results in this request");
    expect(lastMessage).toContain("sarah@northwindlabs.com");
  });

  it("classifies a rejected key as a non-retryable provider error", async () => {
    stubFetchWith(completion({ error: "invalid_api_key" }, 401));

    const error = await llmDecision(
      { context: plannerContext("Hello?"), observations: [], turn: 1 },
      config,
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(AgentError);
    expect(error).toMatchObject({ code: "provider_rejected", retryable: false });
  });

  it("rejects a completion with neither tools nor content", async () => {
    stubFetchWith(completion({ choices: [{ message: { content: null } }] }));

    await expect(
      llmDecision({ context: plannerContext("Hello?"), observations: [], turn: 1 }, config),
    ).rejects.toMatchObject({ code: "provider_bad_response" });
  });

  it("returns no tool steps when the model answers without tool calls", async () => {
    stubFetchWith(
      completion({
        choices: [{ message: { content: "I'm just a demo — no tools needed." } }],
      }),
    );

    const plan = await llmPlanner(plannerContext("Thanks!"), config);

    expect(plan.steps).toEqual([]);
    expect(plan.note).toBe("I'm just a demo — no tools needed.");
  });
});

describe("bounded retry around the planner", () => {
  const input = () => ({
    context: plannerContext("Anything for me?"),
    observations: [],
    turn: 1,
  });

  it("retries a rate limit once and uses the successful answer", async () => {
    const fetchMock = stubFetchWith(
      completion({ error: "slow down" }, 429),
      completion({ choices: [{ message: { content: "Your inbox is quiet." } }] }),
    );
    const beforeRetry = vi.fn();

    const decision = await llmDecisionWithRetry(input(), config, {}, { beforeRetry });

    expect(decision).toMatchObject({ kind: "reply", message: "Your inbox is quiet." });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(beforeRetry).toHaveBeenCalledTimes(1);
  });

  it("does not retry a rejected credential", async () => {
    const fetchMock = stubFetchWith(
      completion({ error: "invalid_api_key" }, 401),
      completion({ choices: [{ message: { content: "never used" } }] }),
    );
    const onFinalError = vi.fn();

    await expect(
      llmDecisionWithRetry(input(), config, {}, { onFinalError }),
    ).rejects.toMatchObject({ code: "provider_rejected", retryable: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onFinalError).toHaveBeenCalledTimes(1);
  });

  it("stops after the attempt budget and surfaces a retryable timeout", async () => {
    const timeout = new DOMException("The operation timed out.", "TimeoutError");
    const fetchMock = stubFetchWith(timeout, timeout, timeout);

    await expect(
      llmDecisionWithRetry(input(), config, {}, { maxAttempts: 2 }),
    ).rejects.toMatchObject({ code: "provider_timeout", retryable: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
