import { describe, expect, it, vi } from "vitest";
import { composeObservations, runAgentLoop, stepKey } from "@/convex/lib/agentLoop";
import { AgentError } from "@/convex/lib/errors";
import type {
  AgentDecision,
  PlannerContext,
  ToolObservation,
} from "@/convex/lib/types";
import { createMemoryPort, NOW } from "./helpers/memory-port";

function context(prompt: string, extra: Partial<PlannerContext> = {}): PlannerContext {
  const port = createMemoryPort();
  return {
    now: NOW,
    prompt,
    recentMessages: [],
    mail: port.state.mail,
    drafts: port.state.drafts.filter((draft) => draft.status === "draft"),
    events: port.state.events,
    tasks: port.state.tasks,
    ...extra,
  };
}

function observation(
  stepIndex: number,
  tool: string,
  summary: string,
  data?: unknown,
): ToolObservation {
  return { stepIndex, tool, args: {}, ok: true, summary, data };
}

describe("agent loop", () => {
  it("feeds tool results back to the planner and answers from them", async () => {
    const seen: ToolObservation[][] = [];
    const planner = async ({
      observations,
      turn,
    }: {
      observations: ToolObservation[];
      turn: number;
    }): Promise<AgentDecision> => {
      seen.push(observations);
      if (turn === 1) {
        return {
          kind: "tools",
          provider: "llm:test",
          steps: [
            {
              tool: "email.searchThreads",
              args: { needsAttention: true, limit: 2 },
              rationale: "Scan the inbox first.",
            },
          ],
        };
      }
      const threads = (observations[0].data as { threads: unknown[] }).threads;
      return {
        kind: "reply",
        provider: "llm:test",
        message: `${threads.length} threads need a reply.`,
      };
    };

    const executeStep = vi.fn(async (step, index) => ({
      status: "executed" as const,
      observation: observation(index, step.tool, "2 threads need attention", {
        threads: [{ id: "a" }, { id: "b" }],
      }),
    }));

    const outcome = await runAgentLoop({
      planner,
      executeStep,
      context: context("What needs my attention?"),
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.message).toBe("2 threads need a reply.");
    expect(outcome.turns).toBe(2);
    expect(executeStep).toHaveBeenCalledTimes(1);
    // Turn two saw exactly what turn one produced.
    expect(seen[0]).toHaveLength(0);
    expect(seen[1]).toHaveLength(1);
  });

  it("never executes the same successful call twice", async () => {
    const planner = async (): Promise<AgentDecision> => ({
      kind: "tools",
      provider: "llm:test",
      steps: [
        { tool: "email.searchThreads", args: { limit: 3 }, rationale: "repeat" },
      ],
    });
    const executeStep = vi.fn(async (step, index) => ({
      status: "executed" as const,
      observation: observation(index, step.tool, "3 messages found"),
    }));

    const outcome = await runAgentLoop({
      planner,
      executeStep,
      context: context("Search my inbox"),
      maxTurns: 3,
    });

    expect(executeStep).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    // The loop stops when the only planned step is already done, and answers
    // from the real result instead of running it again.
    expect(outcome.message).toBe("3 messages found");
  });

  it("stops for approval and keeps the work already done", async () => {
    const planner = async (): Promise<AgentDecision> => ({
      kind: "tools",
      provider: "llm:test",
      steps: [
        { tool: "email.searchThreads", args: { limit: 2 }, rationale: "scan" },
        { tool: "email.sendDraft", args: { draftId: "draft_sarah" }, rationale: "send" },
      ],
    });
    const executeStep = vi.fn(async (step, index) => {
      if (step.tool === "email.sendDraft") {
        return {
          status: "awaiting_approval" as const,
          approval: {
            title: "Send reply to Sarah Chen",
            detail: "Re: Q3 launch timeline",
            stepIndex: index,
            tool: step.tool,
          },
        };
      }
      return {
        status: "executed" as const,
        observation: observation(index, step.tool, "1 message found"),
      };
    });

    const outcome = await runAgentLoop({
      planner,
      executeStep,
      context: context("Send it"),
    });

    expect(outcome.status).toBe("awaiting_approval");
    if (outcome.status !== "awaiting_approval") return;
    expect(outcome.stepIndex).toBe(1);
    expect(outcome.approval.title).toBe("Send reply to Sarah Chen");
    expect(outcome.observations).toHaveLength(1);
    expect(executeStep).toHaveBeenCalledTimes(2);
  });

  it("returns a structured failure when planning throws", async () => {
    const planner = async (): Promise<AgentDecision> => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    };

    const outcome = await runAgentLoop({
      planner,
      executeStep: vi.fn(),
      context: context("Anything"),
    });

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.error.code).toBe("provider_timeout");
    expect(outcome.error.retryable).toBe(true);
  });

  it("stops a failing step with its error code", async () => {
    const planner = async (): Promise<AgentDecision> => ({
      kind: "tools",
      provider: "llm:test",
      steps: [{ tool: "calendar.listEvents", args: {}, rationale: "list" }],
    });

    const outcome = await runAgentLoop({
      planner,
      executeStep: async () => ({
        status: "failed",
        error: new AgentError({
          code: "tool_failed",
          message: "The adapter is down.",
        }),
        observation: {
          stepIndex: 0,
          tool: "calendar.listEvents",
          args: {},
          ok: false,
          summary: "failed",
          error: "The adapter is down.",
        },
      }),
      context: context("What is on my calendar?"),
    });

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.error.code).toBe("tool_failed");
    expect(outcome.observations).toHaveLength(1);
  });

  it("answers from observations when the turn budget runs out", async () => {
    let turn = 0;
    const planner = async (): Promise<AgentDecision> => {
      turn += 1;
      return {
        kind: "tools",
        provider: "llm:test",
        steps: [
          {
            tool: "email.searchThreads",
            args: { limit: turn },
            rationale: "distinct each turn",
          },
        ],
      };
    };
    const executeStep = async (step: { tool: string }, index: number) => ({
      status: "executed" as const,
      observation: observation(index, step.tool, `search ${index} done`),
    });

    const outcome = await runAgentLoop({
      planner,
      executeStep,
      context: context("Keep looking"),
      maxTurns: 2,
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.budgetExhausted).toBe(true);
    expect(outcome.message).toContain("search 0 done");
    expect(outcome.message).toContain("search 1 done");
  });

  it("treats an empty reply as a cancelled run instead of a blank answer", async () => {
    const outcome = await runAgentLoop({
      planner: async () => ({ kind: "reply", provider: "llm:test", message: "   " }),
      executeStep: vi.fn(),
      context: context("Anything"),
    });

    // Only a stream cut short by cancellation produces this, and the UI must
    // not save an empty assistant message for it.
    expect(outcome.status).toBe("cancelled");
    if (outcome.status !== "cancelled") return;
    expect(outcome.provider).toBe("llm:test");
  });

  it("surfaces a clarification with clickable options", async () => {
    const planner = async (): Promise<AgentDecision> => ({
      kind: "clarify",
      provider: "llm:test",
      question: "Which thread should I reply to?",
      options: ["Reply to Sarah Chen", "Reply to Marcus Webb"],
    });

    const outcome = await runAgentLoop({
      planner,
      executeStep: vi.fn(),
      context: context("Draft a reply"),
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.clarified).toBe(true);
    expect(outcome.message).toMatch(/which thread/i);
    expect(outcome.suggestions).toEqual([
      "Reply to Sarah Chen",
      "Reply to Marcus Webb",
    ]);
  });

  it("only persists steps it is about to run, and reports progress", async () => {
    const onPlan = vi.fn();
    const onActivity = vi.fn();
    const planner = async ({ turn }: { turn: number }): Promise<AgentDecision> =>
      turn === 1
        ? {
            kind: "tools",
            provider: "llm:test",
            steps: [
              { tool: "email.searchThreads", args: { limit: 1 }, rationale: "one" },
            ],
          }
        : { kind: "reply", provider: "llm:test", message: "Done." };

    await runAgentLoop({
      planner,
      executeStep: async (step, index) => ({
        status: "executed",
        observation: observation(index, step.tool, "ok"),
      }),
      context: context("Anything"),
      onPlan,
      onActivity,
    });

    expect(onPlan).toHaveBeenCalledTimes(1);
    expect(onPlan.mock.calls[0][0]).toHaveLength(1);
    expect(onActivity.mock.calls.map(([value]) => value)).toEqual([
      "Planning the request…",
      "Running email.searchThreads…",
      "Reviewing tool results…",
    ]);
  });

  it("continues from a global step index when resuming", async () => {
    const executeStep = vi.fn(async (step, index) => ({
      status: "executed" as const,
      observation: observation(index, step.tool, "ok"),
    }));

    const outcome = await runAgentLoop({
      planner: async () => ({
        kind: "tools",
        provider: "llm:test",
        steps: [{ tool: "tasks.listOpen", args: {}, rationale: "continue" }],
      }),
      executeStep,
      context: context("continue"),
      startIndex: 3,
      initialObservations: [observation(2, "email.sendDraft", "Sent the reply.")],
      maxTurns: 1,
    });

    expect(executeStep).toHaveBeenCalledWith(expect.anything(), 3);
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.observations.map((item) => item.stepIndex)).toEqual([2, 3]);
  });
});

describe("step keys", () => {
  it("treats reordered arguments as the same step", () => {
    expect(stepKey("email.searchThreads", { limit: 3, needsAttention: true })).toBe(
      stepKey("email.searchThreads", { needsAttention: true, limit: 3 }),
    );
    expect(stepKey("email.searchThreads", { limit: 3 })).not.toBe(
      stepKey("email.searchThreads", { limit: 4 }),
    );
  });

  it("composes only what the tools returned", () => {
    expect(composeObservations([])).toBeUndefined();
    expect(
      composeObservations([observation(0, "a", "first"), observation(1, "b", "second")]),
    ).toBe("first\n\nsecond");
    expect(composeObservations([observation(0, "a", "first")], "note")).toBe("note\n\nfirst");
  });
});
