import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentLoop, type StepOutcome } from "@/convex/lib/agentLoop";
import { AgentError } from "@/convex/lib/errors";
import { llmDecision, type LlmConfig } from "@/convex/lib/llmPlanner";
import { decideTool, type AgentPolicy } from "@/convex/lib/policy";
import { getTool, validateStep } from "@/convex/lib/tools";
import type {
  AgentDecision,
  PlanStep,
  PlannerContext,
  ToolObservation,
} from "@/convex/lib/types";
import { createMemoryPort, NOW, type MemoryState } from "./helpers/memory-port";

/**
 * End-to-end conversation tests: the real model planner, the real agent loop,
 * the real tool registry, and the in-memory workspace port, with a scripted
 * OpenAI-compatible provider behind `fetch`. No paid API call is made.
 */

const config: LlmConfig = {
  apiKey: "test-key",
  baseUrl: "https://llm.test/v1",
  model: "test-model",
  maxTokens: 1200,
};

const allowAll: AgentPolicy = { allowWrites: true, allowOutbound: true };

function textDelta(value: string) {
  return { choices: [{ delta: { content: value } }] };
}

function callDelta(
  index: number,
  fragment: { id?: string; name?: string; arguments?: string },
) {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index,
              ...(fragment.id ? { id: fragment.id } : {}),
              function: {
                ...(fragment.name !== undefined ? { name: fragment.name } : {}),
                ...(fragment.arguments !== undefined ? { arguments: fragment.arguments } : {}),
              },
            },
          ],
        },
      },
    ],
  };
}

/** A streamed completion, delivered in separate chunks like a real provider. */
function stream(frames: unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const frame of frames) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Scripts the provider in call order and records every request body. */
function stubProvider(...responses: (Response | Error)[]) {
  const bodies: Record<string, unknown>[] = [];
  const mock = vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    const next = responses.shift();
    if (!next) throw new Error("the planner called the provider more times than scripted");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", mock);
  return { mock, bodies };
}

function contextFor(prompt: string, state: Partial<MemoryState> = {}): PlannerContext {
  const port = createMemoryPort();
  return {
    now: NOW,
    prompt,
    recentMessages: [],
    mail: state.mail ?? port.state.mail,
    drafts: port.state.drafts.filter((draft) => draft.status === "draft"),
    events: port.state.events,
    tasks: port.state.tasks,
  };
}

/**
 * A minimal stand-in for the orchestrator's executor: same validation, same
 * policy gate, same approval pause, real tool implementations.
 */
function executor(policy: AgentPolicy = allowAll) {
  const port = createMemoryPort();
  const executed: { tool: string; args: unknown }[] = [];

  const executeStep = async (step: PlanStep, stepIndex: number): Promise<StepOutcome> => {
    const validation = validateStep(step);
    if (!validation.ok) {
      return {
        status: "failed",
        error: new AgentError({ code: "plan_invalid", message: validation.error }),
      };
    }
    const tool = getTool(step.tool);
    if (!tool) {
      return {
        status: "failed",
        error: new AgentError({ code: "tool_not_found", message: `Unknown tool ${step.tool}` }),
      };
    }
    const permission = decideTool(tool, policy);
    if (permission.decision === "deny") {
      return {
        status: "failed",
        error: new AgentError({ code: "tool_denied", message: permission.reason }),
      };
    }
    if (permission.decision === "approval") {
      return {
        status: "awaiting_approval",
        approval: { title: tool.label, detail: step.tool, stepIndex, tool: tool.name },
      };
    }

    executed.push({ tool: step.tool, args: validation.args });
    const result = await tool.run(validation.args, { port, now: NOW });
    const observation: ToolObservation = {
      stepIndex,
      tool: step.tool,
      args: step.args,
      ok: result.ok,
      summary: result.summary,
      ...(result.ok ? { data: result.data } : { error: result.error }),
    };
    if (!result.ok) {
      return {
        status: "failed",
        error: new AgentError({ code: "tool_failed", message: result.error }),
        observation,
      };
    }
    return { status: "executed", observation };
  };

  return { executeStep, executed, port };
}

type ConverseOptions = {
  policy?: AgentPolicy;
  state?: Partial<MemoryState>;
  priorObservations?: ToolObservation[];
  recentMessages?: PlannerContext["recentMessages"];
  onText?: (text: string) => void;
  shouldStop?: () => boolean | Promise<boolean>;
  maxTurns?: number;
};

async function converse(prompt: string, options: ConverseOptions = {}) {
  const { executeStep, executed, port } = executor(options.policy);
  const streamed: string[] = [];
  const context = contextFor(prompt, options.state);
  const planner = (input: {
    context: PlannerContext;
    observations: ToolObservation[];
    turn: number;
  }): Promise<AgentDecision> =>
    llmDecision(input, config, {
      onText: (text) => {
        streamed.push(text);
        options.onText?.(text);
      },
    });

  const outcome = await runAgentLoop({
    planner,
    executeStep,
    context: {
      ...context,
      recentMessages: options.recentMessages ?? [],
      priorObservations: options.priorObservations,
    },
    shouldStop: options.shouldStop,
    maxTurns: options.maxTurns,
  });

  return { outcome, executed, streamed, port };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("open-ended conversation", () => {
  it("answers a question that needs no tool, and streams the answer", async () => {
    const { mock, bodies } = stubProvider(
      stream([textDelta("Your inbox is quiet. "), textDelta("Nothing needs a reply.")]),
    );

    const { outcome, executed, streamed } = await converse("Anything urgent for me?");

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.message).toBe("Your inbox is quiet. Nothing needs a reply.");
    expect(executed).toEqual([]);
    // Progressive delivery: the caller saw the text before the turn finished.
    expect(streamed[0]).toBe("Your inbox is quiet. ");
    expect(streamed.at(-1)).toBe("Your inbox is quiet. Nothing needs a reply.");
    expect(mock).toHaveBeenCalledTimes(1);
    // The app asks the provider to stream, so tokens can render as they arrive.
    expect(bodies[0].stream).toBe(true);
  });

  it("maps unfamiliar phrasing to a registered tool and grounds the answer in its result", async () => {
    const { bodies } = stubProvider(
      stream([
        callDelta(0, {
          id: "call_search",
          name: "email.searchThreads",
          arguments: '{"needsAttention":true,"limit":5}',
        }),
      ]),
      stream([textDelta("Sarah Chen still needs the launch deck by Thursday.")]),
    );

    const { outcome, executed } = await converse(
      "Who's got something on my plate I haven't dealt with?",
    );

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.message).toBe("Sarah Chen still needs the launch deck by Thursday.");
    expect(executed).toEqual([
      { tool: "email.searchThreads", args: { needsAttention: true, limit: 5 } },
    ]);
    // The second turn is only possible if the runtime returned the real result.
    expect(bodies).toHaveLength(2);
    const followUp = String(
      (bodies[1].messages as { content: string }[]).at(-1)?.content ?? "",
    );
    expect(followUp).toContain("Tool results in this request");
    expect(followUp).toContain("mail_sarah");
    expect(outcome.observations[0].ok).toBe(true);
  });

  it("carries earlier tool results into a follow-up request", async () => {
    const { bodies } = stubProvider(
      stream([textDelta("Marcus Webb wants a final read of the pricing copy.")]),
    );

    const { outcome } = await converse("what about the other one?", {
      priorObservations: [
        {
          stepIndex: 0,
          tool: "email.summarizeThread",
          args: { threadId: "mail_marcus" },
          ok: true,
          summary: "**Pricing page copy — final pass** — from Marcus Webb",
          data: { thread: { id: "mail_marcus", from: "Marcus Webb" } },
        },
      ],
    });

    expect(outcome.status).toBe("completed");
    const opening = String((bodies[0].messages as { content: string }[]).at(-1)?.content ?? "");
    expect(opening).toContain("Earlier tool results in this conversation");
    expect(opening).toContain("mail_marcus");
    expect(opening).toContain("User request: what about the other one?");
  });

  it("sends the conversation so a correction can override the previous turn", async () => {
    const { bodies } = stubProvider(
      stream([textDelta("Sarah Chen is waiting on the Q3 launch timeline.")]),
    );

    const { outcome } = await converse("no, the Sarah one", {
      recentMessages: [
        { role: "user", content: "Summarize the Marcus thread" },
        {
          role: "assistant",
          content: "Marcus Webb wants a final read of the pricing-page copy.",
        },
      ],
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.message).toContain("Sarah Chen");

    const messages = bodies[0].messages as { role: string; content: string }[];
    expect(messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages[1].content).toBe("Summarize the Marcus thread");
    expect(messages[2].content).toContain("Marcus Webb");
    // The correction is the current request, not an appended afterthought.
    expect(messages.at(-1)?.content).toContain("User request: no, the Sarah one");
  });

  it("asks for a missing required argument instead of failing the run", async () => {
    stubProvider(
      stream([
        callDelta(0, {
          id: "call_task",
          name: "tasks.createFollowUp",
          arguments: '{"source":"Marcus Webb"}',
        }),
      ]),
    );

    const { outcome, executed } = await converse("Add a follow-up for Marcus");

    expect(executed).toEqual([]);
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.clarified).toBe(true);
    expect(outcome.message).toMatch(/title/i);
    expect(outcome.suggestions).toEqual([]);
  });

  it("runs the valid call and drops the one whose arguments are out of range", async () => {
    stubProvider(
      stream([
        callDelta(0, {
          id: "call_bad",
          name: "email.searchThreads",
          arguments: '{"limit":0}',
        }),
        callDelta(1, { id: "call_good", name: "tasks.listOpen", arguments: "{}" }),
      ]),
      stream([textDelta("You have one open follow-up: send the launch deck to Sarah.")]),
    );

    const { outcome, executed } = await converse("What am I tracking?");

    expect(outcome.status).toBe("completed");
    expect(executed).toEqual([{ tool: "tasks.listOpen", args: {} }]);
  });

  it("fails with a provider code when the completion body is unusable", async () => {
    stubProvider(
      new Response("not json at all", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { outcome, executed } = await converse("Summarize my day");

    expect(executed).toEqual([]);
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.error.code).toBe("provider_bad_response");
  });

  it("surfaces a rate limit as a retryable provider failure", async () => {
    stubProvider(json({ error: "slow down" }, 429));

    const { outcome, executed } = await converse("Triage my inbox");

    expect(executed).toEqual([]);
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.error.code).toBe("provider_rate_limited");
    expect(outcome.error.retryable).toBe(true);
  });

  it("stops a cancelled run before the next turn executes anything", async () => {
    stubProvider(
      stream([
        callDelta(0, {
          id: "call_search",
          name: "email.searchThreads",
          arguments: '{"needsAttention":true}',
        }),
      ]),
      stream([textDelta("This answer should never be used.")]),
    );

    let checks = 0;
    const { outcome, executed } = await converse("What needs my attention?", {
      // Checked at the top of a turn, after planning, and before each step: the
      // fourth check is the start of turn two, after one step has run.
      shouldStop: () => {
        checks += 1;
        return checks >= 4;
      },
    });

    expect(outcome.status).toBe("cancelled");
    expect(executed).toHaveLength(1);
  });

  it("never executes the same tool call twice when the model repeats it", async () => {
    const repeated = [
      callDelta(0, {
        id: "call_a",
        name: "email.searchThreads",
        arguments: '{"limit":3}',
      }),
    ];
    stubProvider(stream(repeated), stream(repeated), stream(repeated));

    const { outcome, executed } = await converse("Look in my inbox", { maxTurns: 3 });

    expect(executed).toHaveLength(1);
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    // The answer is built from the one real result, not a second execution.
    expect(outcome.message).toContain("messages");
  });

  it("holds a send for approval and never executes it on the spot", async () => {
    stubProvider(
      stream([
        callDelta(0, {
          id: "call_send",
          name: "email.sendDraft",
          arguments: '{"draftId":"draft_sarah"}',
        }),
      ]),
    );

    const { outcome, executed, port } = await converse("Send it");

    expect(outcome.status).toBe("awaiting_approval");
    if (outcome.status !== "awaiting_approval") return;
    expect(outcome.approval.tool).toBe("email.sendDraft");
    expect(executed).toEqual([]);
    expect(port.state.drafts[0].status).toBe("draft");
  });

  it("refuses a tool the deployment disables", async () => {
    stubProvider(
      stream([
        callDelta(0, {
          id: "call_draft",
          name: "email.draftReply",
          arguments: '{"threadId":"mail_sarah"}',
        }),
      ]),
    );

    const { outcome, executed, port } = await converse("Draft a reply to Sarah", {
      policy: { allowWrites: false, allowOutbound: true },
    });

    expect(executed).toEqual([]);
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.error.code).toBe("tool_denied");
    // Nothing was written to the workspace.
    expect(port.state.drafts).toHaveLength(1);
  });
});
