import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";
import { runAgentLoop, type LoopOutcome, type PlannerFn, type StepOutcome } from "./lib/agentLoop";
import { backoffMs, delay, toAgentError, userMessageFor } from "./lib/errors";
import { llmDecisionWithRetry } from "./lib/llmPlanner";
import { resolvePlanner, type PlannerProvider } from "./lib/llmProvider";
import { plannerFallbackMessage, rulesPlanner } from "./lib/planner";
import { decideTool, policyFromEnv } from "./lib/policy";
import { getTool, validateStep } from "./lib/tools";
import type {
  AgentDecision,
  PlanStep,
  PlannerContext,
  PlannerResult,
  ToolContext,
  ToolObservation,
  ToolResult,
  WorkspacePort,
} from "./lib/types";

const MAX_TURNS = 3;
const MAX_STEPS_PER_TURN = 4;
const MAX_TOOL_ATTEMPTS = 2;
const STREAM_WRITE_INTERVAL_MS = 120;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error.";
}

function env(): Record<string, string | undefined> {
  return process.env as Record<string, string | undefined>;
}

function providerLabel(provider: PlannerProvider): string {
  return provider.kind === "llm" ? `llm:${provider.config.model}` : "rules";
}

function makePort(ctx: ActionCtx, runId: Id<"agentRuns">): WorkspacePort {
  return {
    searchMail: (input) => ctx.runQuery(internal.workspace.searchMail, input),
    getMailThread: (id) => ctx.runQuery(internal.workspace.getMailThread, { id }),
    createDraft: (input) =>
      ctx.runMutation(internal.workspace.createDraft, {
        ...input,
        runId: runId as string,
      }),
    getDraft: (id) => ctx.runQuery(internal.workspace.getDraft, { id }),
    resolveDraft: (id) => ctx.runQuery(internal.workspace.resolveDraft, { draftId: id }),
    sendDraft: (id) => ctx.runMutation(internal.workspace.sendDraft, { id }),
    listEvents: (input) => ctx.runQuery(internal.workspace.listEvents, input),
    getEvent: (id) => ctx.runQuery(internal.workspace.getEvent, { id }),
    createFollowUp: (input) => ctx.runMutation(internal.workspace.createFollowUp, input),
    listFollowUps: () => ctx.runQuery(internal.workspace.listFollowUps, {}),
  };
}

/**
 * Progressive rendering: deltas land in one assistant message, which the client
 * already subscribes to. Writes are throttled so a fast stream doesn't hammer
 * the database, and the message is deleted if the turn turns out to be a tool
 * call instead of an answer.
 */
type StreamSink = {
  id: () => Id<"messages"> | null;
  text: () => string;
  write: (text: string, force?: boolean) => Promise<void>;
  discard: () => Promise<void>;
};

function createSink(
  ctx: ActionCtx,
  runId: Id<"agentRuns">,
  threadId: Id<"threads">,
): StreamSink {
  let messageId: Id<"messages"> | null = null;
  let text = "";
  let lastWrite = 0;
  let discarded = false;

  return {
    id: () => messageId,
    text: () => text,
    async write(next, force = false) {
      if (discarded) return;
      text = next;
      if (!messageId) {
        messageId = await ctx.runMutation(internal.agent.beginAssistantMessage, {
          runId,
          threadId,
        });
      }
      const now = Date.now();
      if (!force && now - lastWrite < STREAM_WRITE_INTERVAL_MS) return;
      lastWrite = now;
      await ctx.runMutation(internal.agent.updateAssistantText, {
        messageId,
        content: next,
      });
    },
    async discard() {
      discarded = true;
      if (messageId) {
        await ctx.runMutation(internal.agent.deleteMessage, { messageId });
      }
      messageId = null;
      text = "";
    },
  };
}

/**
 * Run one tool, retrying only transient failures and only for tools that
 * cannot duplicate a side effect. An approved outbound action never retries.
 */
async function runTool(
  tool: NonNullable<ReturnType<typeof getTool>>,
  args: unknown,
  context: ToolContext,
  maxAttempts: number,
): Promise<{ result: ToolResult; attempts: number; error?: ReturnType<typeof toAgentError> }> {
  const attemptsAllowed = tool.sideEffect ? 1 : maxAttempts;
  let attempts = 0;
  let lastError = toAgentError(new Error("Tool did not run."), "tool_failed");

  while (attempts < attemptsAllowed) {
    attempts += 1;
    try {
      return { result: await tool.run(args, context), attempts };
    } catch (error) {
      lastError = toAgentError(error, "tool_failed");
      if (!lastError.retryable || attempts >= attemptsAllowed) break;
      await delay(backoffMs(attempts));
    }
  }

  return {
    attempts,
    error: lastError,
    result: {
      ok: false,
      error: lastError.message,
      summary: `**${tool.label}** failed: ${lastError.message}`,
    },
  };
}

function observationFrom(
  result: ToolResult,
  step: PlanStep,
  stepIndex: number,
): ToolObservation {
  return {
    stepIndex,
    tool: step.tool,
    args: step.args,
    ok: result.ok,
    summary: result.summary,
    ...(result.ok ? { data: result.data } : { error: result.error }),
  };
}

function toDecision(plan: PlannerResult, modelConfigured = true): AgentDecision {
  if (plan.clarification) {
    return {
      kind: "clarify",
      provider: plan.provider,
      question: plan.clarification.question,
      options: plan.clarification.options,
    };
  }
  if (plan.answer) {
    return {
      kind: "reply",
      provider: plan.provider,
      message: plan.answer,
      suggestions: plan.suggestions,
    };
  }
  if (plan.steps.length > 0) {
    return { kind: "tools", provider: plan.provider, steps: plan.steps, note: plan.note };
  }
  return {
    kind: "reply",
    provider: plan.provider,
    message: plannerFallbackMessage(plan, modelConfigured),
  };
}

/**
 * The planning function for one run. With no provider configured the built-in
 * patterns answer the requests they can genuinely handle and say plainly when
 * they cannot. With a provider configured it is a grounded model loop that
 * streams its answer; a failure after one bounded retry fails the run with a
 * recoverable error (the UI offers Retry) instead of pretending patterns are
 * an answer.
 */
function makePlanner(
  runId: Id<"agentRuns">,
  provider: PlannerProvider,
  sink: StreamSink,
  shouldStop: () => Promise<boolean>,
): PlannerFn {
  return async ({ context, observations, turn }) => {
    // The pattern interpreter has no message history, so it resolves follow-ups
    // from the observations directly. The model gets them as a separate block.
    const withHistory = (): PlannerContext => ({
      ...context,
      priorObservations: [...(context.priorObservations ?? []), ...observations],
    });

    if (provider.kind !== "llm") {
      await sink.discard();
      // Nothing can call a model here, so the reply says so when the built-in
      // patterns had no answer instead of implying the request was understood.
      return toDecision(rulesPlanner(withHistory()), false);
    }

    // Discard anything a previous turn streamed: only the final answer stays.
    await sink.discard();
    return llmDecisionWithRetry(
      { context, observations, turn },
      provider.config,
      {
        onText: (text) => sink.write(text),
        shouldStop,
      },
      {
        maxAttempts: 2,
        beforeRetry: () => sink.discard(),
        onFinalError: (failure) => {
          // Codes and identifiers only: never the prompt, the completion, or a key.
          console.warn("LLM planner call failed", {
            code: failure.code,
            status: failure.status ?? null,
            model: provider.config.model,
            turn,
            runId,
          });
        },
      },
    );
  };
}

function makeExecutor(ctx: ActionCtx, runId: Id<"agentRuns">) {
  const port = makePort(ctx, runId);
  const policy = policyFromEnv(env());

  return async (step: PlanStep, stepIndex: number): Promise<StepOutcome> => {
    const validation = validateStep(step);
    if (!validation.ok) {
      const missing = validation.missing;
      const message = missing?.length
        ? `Missing required argument${missing.length === 1 ? "" : "s"} for ${step.tool}: ${missing.join(", ")}.`
        : validation.error;
      const code = missing?.length ? "plan_missing_arguments" : "plan_invalid";
      const executionId = await ctx.runMutation(internal.agent.startExecution, {
        runId,
        stepIndex,
        tool: step.tool,
        args: step.args ?? {},
        requiresApproval: false,
      });
      await ctx.runMutation(internal.agent.finishExecution, {
        executionId,
        status: "failed",
        error: message,
        summary: message,
        durationMs: 0,
        nextStep: stepIndex + 1,
      });
      return {
        status: "failed",
        error: toAgentError(new Error(message), code),
        observation: {
          stepIndex,
          tool: step.tool,
          args: step.args,
          ok: false,
          summary: message,
          error: message,
        },
      };
    }

    const tool = getTool(step.tool);
    if (!tool) {
      return {
        status: "failed",
        error: toAgentError(new Error(`Unknown tool ${step.tool}`), "tool_not_found"),
      };
    }

    // The model never decides this: every step goes through one policy check.
    const permission = decideTool(tool, policy);
    if (permission.decision === "deny") {
      const executionId = await ctx.runMutation(internal.agent.startExecution, {
        runId,
        stepIndex,
        tool: tool.name,
        args: validation.args,
        requiresApproval: false,
      });
      await ctx.runMutation(internal.agent.finishExecution, {
        executionId,
        status: "failed",
        error: permission.reason,
        summary: permission.reason,
        durationMs: 0,
        nextStep: stepIndex + 1,
      });
      return {
        status: "failed",
        error: toAgentError(new Error(permission.reason), "tool_denied"),
        observation: {
          stepIndex,
          tool: tool.name,
          args: validation.args,
          ok: false,
          summary: permission.reason,
          error: permission.reason,
        },
      };
    }

    const toolContext: ToolContext = { port, now: Date.now(), runId: runId as string };

    if (permission.decision === "approval") {
      let copy = {
        title: tool.label,
        detail: `Tool: ${tool.name}\nArguments: ${JSON.stringify(validation.args, null, 2)}`,
      };
      if (tool.describeApproval) {
        try {
          copy = await tool.describeApproval(validation.args, toolContext);
        } catch {
          // Fall back to the generic description; approval is still required.
        }
      }
      const executionId = await ctx.runMutation(internal.agent.startExecution, {
        runId,
        stepIndex,
        tool: tool.name,
        args: validation.args,
        requiresApproval: true,
      });
      await ctx.runMutation(internal.agent.pauseForApproval, {
        runId,
        executionId,
        stepIndex,
        title: copy.title,
        detail: copy.detail,
        message: `**${copy.title}** is ready and waiting for your approval. Nothing has been executed yet — review it below, then approve or decline.`,
      });
      return {
        status: "awaiting_approval",
        approval: { title: copy.title, detail: copy.detail, stepIndex, tool: tool.name },
      };
    }

    const executionId = await ctx.runMutation(internal.agent.startExecution, {
      runId,
      stepIndex,
      tool: tool.name,
      args: validation.args,
      requiresApproval: false,
    });
    const startedAt = Date.now();
    const { result, attempts } = await runTool(
      tool,
      validation.args,
      toolContext,
      MAX_TOOL_ATTEMPTS,
    );
    await ctx.runMutation(internal.agent.finishExecution, {
      executionId,
      status: result.ok ? "succeeded" : "failed",
      summary: result.summary,
      result: result.ok ? result.data : undefined,
      error: result.ok ? undefined : result.error,
      durationMs: Date.now() - startedAt,
      attempts,
      nextStep: stepIndex + 1,
    });

    const observation = observationFrom(result, step, stepIndex);
    if (!result.ok) {
      return {
        status: "failed",
        error: toAgentError(new Error(result.error || result.summary), "tool_failed"),
        observation,
      };
    }
    return { status: "executed", observation };
  };
}

async function finalize(
  ctx: ActionCtx,
  runId: Id<"agentRuns">,
  outcome: LoopOutcome,
  sink: StreamSink,
): Promise<"completed" | "awaiting_approval" | "failed" | "cancelled"> {
  if (outcome.status === "failed") {
    await sink.discard();
    await ctx.runMutation(internal.agent.failRun, {
      runId,
      error: outcome.error.message,
      userMessage: userMessageFor(outcome.error),
      errorCode: outcome.error.code,
      turns: outcome.turns,
      provider: outcome.provider,
    });
    return "failed";
  }

  if (outcome.status === "cancelled") {
    await ctx.runMutation(internal.agent.stopRun, {
      runId,
      messageId: sink.id() ?? undefined,
      partial: sink.text(),
    });
    return "cancelled";
  }

  if (outcome.status === "awaiting_approval") {
    await sink.discard();
    return "awaiting_approval";
  }

  await ctx.runMutation(internal.agent.completeRun, {
    runId,
    summary: outcome.message,
    suggestions: outcome.suggestions,
    turns: outcome.turns,
    provider: outcome.provider,
    messageId: sink.id() ?? undefined,
  });
  return "completed";
}

const runStatusResult = v.union(
  v.literal("running"),
  v.literal("awaiting_approval"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

type RunStatus = "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";

async function loadContext(
  ctx: ActionCtx,
  threadId: Id<"threads">,
  runId: Id<"agentRuns">,
  prompt: string,
): Promise<PlannerContext> {
  const contextRaw = await ctx.runQuery(internal.workspace.getAgentContext, {
    threadId,
    runId,
  });
  return {
    now: contextRaw.now,
    prompt,
    recentMessages: contextRaw.recentMessages,
    mail: contextRaw.mail,
    drafts: contextRaw.drafts,
    events: contextRaw.events,
    tasks: contextRaw.tasks,
    priorObservations: contextRaw.priorObservations,
  };
}

function loopCallbacks(ctx: ActionCtx, runId: Id<"agentRuns">) {
  return {
    onPlan: async (steps: PlanStep[], provider: string) => {
      await ctx.runMutation(internal.agent.setPlan, {
        runId,
        plan: steps,
        provider,
        append: true,
      });
    },
    onActivity: async (activity: string) => {
      await ctx.runMutation(internal.agent.setActivity, { runId, activity });
    },
  };
}

/** Cancellation predicate with a small cache so every chunk doesn't hit the DB. */
function makeStopSignal(ctx: ActionCtx, runId: Id<"agentRuns">) {
  let lastCheck = 0;
  let cancelled = false;
  return async (): Promise<boolean> => {
    if (cancelled) return true;
    const now = Date.now();
    if (now - lastCheck < 250) return false;
    lastCheck = now;
    cancelled = await ctx.runQuery(internal.agent.cancelState, { runId });
    return cancelled;
  };
}

type RunResult = { runId: Id<"agentRuns">; status: RunStatus };

function validateText(raw: string): string {
  const text = raw.trim();
  if (!text) throw new Error("Message cannot be empty.");
  if (text.length > 4000) throw new Error("Message is too long (4000 character limit).");
  return text;
}

/**
 * The one execution path shared by a new message, an edited message, and a
 * retried answer. Ownership is asserted by the caller before anything is
 * written, and the loop itself is identical in all three cases.
 */
async function executeConversation(
  ctx: ActionCtx,
  {
    threadId,
    text,
    announceUserMessage = true,
  }: { threadId: Id<"threads">; text: string; announceUserMessage?: boolean },
): Promise<RunResult> {
  const provider = resolvePlanner(env());
  const started: { runId: Id<"agentRuns"> } = await ctx.runMutation(internal.agent.startRun, {
    threadId,
    text,
    provider: providerLabel(provider),
    announceUserMessage,
  });
  const runId = started.runId;

  try {
    const context = await loadContext(ctx, threadId, runId, text);
    const sink = createSink(ctx, runId, threadId);
    const stopped = makeStopSignal(ctx, runId);
    const outcome = await runAgentLoop({
      planner: makePlanner(runId, provider, sink, stopped),
      executeStep: makeExecutor(ctx, runId),
      context,
      maxTurns: MAX_TURNS,
      maxStepsPerTurn: MAX_STEPS_PER_TURN,
      initialProvider: providerLabel(provider),
      shouldStop: stopped,
      ...loopCallbacks(ctx, runId),
    });
    const status = await finalize(ctx, runId, outcome, sink);
    return { runId, status };
  } catch (error) {
    console.error("Agent run failed:", errorMessage(error));
    try {
      await ctx.runMutation(internal.agent.failRun, {
        runId,
        error: errorMessage(error),
        userMessage: userMessageFor(toAgentError(error, "internal")),
        errorCode: toAgentError(error, "internal").code,
      });
    } catch {
      // The run may already be finalized.
    }
    return { runId, status: "failed" as const };
  }
}

export const sendMessage = action({
  args: { threadId: v.id("threads"), text: v.string(), sessionId: v.string() },
  returns: v.object({ runId: v.id("agentRuns"), status: runStatusResult }),
  handler: async (ctx, { threadId, text, sessionId }): Promise<RunResult> => {
    const message = validateText(text);
    // Authorization before anything is written.
    await ctx.runQuery(internal.ownership.assertThreadAccess, { threadId, sessionId });
    return executeConversation(ctx, { threadId, text: message });
  },
});

/** Re-plans an existing user message after discarding its answer(s). */
export const regenerate = action({
  args: { messageId: v.id("messages"), sessionId: v.string() },
  returns: v.object({ runId: v.id("agentRuns"), status: runStatusResult }),
  handler: async (ctx, { messageId, sessionId }): Promise<RunResult> => {
    const prepared = await ctx.runMutation(internal.messages.prepareRegenerate, {
      messageId,
      sessionId,
    });
    await ctx.runQuery(internal.ownership.assertThreadAccess, {
      threadId: prepared.threadId,
      sessionId,
    });
    return executeConversation(ctx, {
      threadId: prepared.threadId,
      text: prepared.text,
      announceUserMessage: false,
    });
  },
});

/** Rewrites a user message, discards the replies after it, and re-runs it. */
export const editMessage = action({
  args: { messageId: v.id("messages"), text: v.string(), sessionId: v.string() },
  returns: v.object({ runId: v.id("agentRuns"), status: runStatusResult }),
  handler: async (ctx, { messageId, text, sessionId }): Promise<RunResult> => {
    const message = validateText(text);
    const prepared = await ctx.runMutation(internal.messages.editUserMessage, {
      messageId,
      text: message,
      sessionId,
    });
    await ctx.runQuery(internal.ownership.assertThreadAccess, {
      threadId: prepared.threadId,
      sessionId,
    });
    return executeConversation(ctx, {
      threadId: prepared.threadId,
      text: prepared.text,
      announceUserMessage: false,
    });
  },
});

export const resumeRun = action({
  args: { runId: v.id("agentRuns"), sessionId: v.string() },
  returns: v.object({ status: runStatusResult }),
  handler: async (ctx, { runId, sessionId }): Promise<{ status: RunStatus }> => {
    await ctx.runQuery(internal.ownership.assertRunAccess, { runId, sessionId });

    const state = await ctx.runQuery(internal.agent.resumeState, { runId });
    if (!state) throw new Error("Run not found.");
    const { run, approval, execution } = state;
    if (run.status !== "awaiting_approval") {
      return { status: run.status };
    }
    if (!approval || approval.status !== "approved") {
      throw new Error("This step still needs approval.");
    }
    if (!execution) throw new Error("Pending execution not found.");

    await ctx.runMutation(internal.agent.markRunning, { runId });
    const port = makePort(ctx, runId);

    if (execution.status === "awaiting_approval") {
      const tool = getTool(execution.tool);
      if (!tool) {
        await ctx.runMutation(internal.agent.failRun, {
          runId,
          error: `Unknown tool ${execution.tool}`,
          userMessage: userMessageFor(
            toAgentError(new Error(`Unknown tool ${execution.tool}`), "tool_not_found"),
          ),
          errorCode: "tool_not_found",
        });
        return { status: "failed" as const };
      }
      // Approval was granted for this exact tool earlier; re-check the policy in
      // case the deployment changed between the request and the decision.
      const permission = decideTool(tool, policyFromEnv(env()));
      if (permission.decision === "deny") {
        await ctx.runMutation(internal.agent.failRun, {
          runId,
          error: permission.reason,
          userMessage: userMessageFor(toAgentError(new Error(permission.reason), "tool_denied")),
          errorCode: "tool_denied",
        });
        return { status: "failed" as const };
      }

      const validation = validateStep({
        tool: execution.tool,
        args: execution.args,
        rationale: "",
      });
      if (!validation.ok) {
        await ctx.runMutation(internal.agent.failRun, {
          runId,
          error: validation.error,
          userMessage: userMessageFor(toAgentError(new Error(validation.error), "plan_invalid")),
          errorCode: "plan_invalid",
        });
        return { status: "failed" as const };
      }
      const toolContext: ToolContext = { port, now: Date.now(), runId: runId as string };
      const startedAt = Date.now();
      // Never retry an approved outbound action automatically.
      const { result, attempts } = await runTool(tool, validation.args, toolContext, 1);
      await ctx.runMutation(internal.agent.finishExecution, {
        executionId: execution._id,
        status: result.ok ? "succeeded" : "failed",
        summary: result.summary,
        result: result.ok ? result.data : undefined,
        error: result.ok ? undefined : result.error,
        durationMs: Date.now() - startedAt,
        attempts,
        nextStep: execution.stepIndex + 1,
      });
      if (!result.ok) {
        await ctx.runMutation(internal.agent.failRun, {
          runId,
          error: result.error ?? result.summary,
          userMessage: userMessageFor(
            toAgentError(new Error(result.error || result.summary), "tool_failed"),
          ),
          errorCode: "tool_failed",
        });
        return { status: "failed" as const };
      }
    } else if (execution.status !== "succeeded") {
      throw new Error(`Unexpected execution state: ${execution.status}`);
    }

    try {
      // The loop sees everything this run already produced, so the answer after
      // an approval still includes the steps that ran before the pause.
      const executions = await ctx.runQuery(internal.agent.runExecutions, { runId });
      const initialObservations: ToolObservation[] = executions
        .filter((item) => item.status === "succeeded")
        .map((item) => ({
          stepIndex: item.stepIndex,
          tool: item.tool,
          args: item.args,
          ok: true,
          summary: item.summary ?? "",
          data: item.result,
        }));
      const startIndex =
        executions.reduce((max, item) => Math.max(max, item.stepIndex + 1), 0) || 0;

      const context = await loadContext(ctx, run.threadId, runId, run.prompt);
      const provider = resolvePlanner(env());
      const sink = createSink(ctx, runId, run.threadId);
      const stopped = makeStopSignal(ctx, runId);
      const outcome = await runAgentLoop({
        planner: makePlanner(runId, provider, sink, stopped),
        executeStep: makeExecutor(ctx, runId),
        context,
        startIndex,
        maxTurns: MAX_TURNS,
        maxStepsPerTurn: MAX_STEPS_PER_TURN,
        initialObservations,
        initialProvider: providerLabel(provider),
        shouldStop: stopped,
        ...loopCallbacks(ctx, runId),
      });
      return { status: await finalize(ctx, runId, outcome, sink) };
    } catch (error) {
      console.error("Agent resume failed:", errorMessage(error));
      try {
        await ctx.runMutation(internal.agent.failRun, {
          runId,
          error: errorMessage(error),
          userMessage: userMessageFor(toAgentError(error, "internal")),
          errorCode: toAgentError(error, "internal").code,
        });
      } catch {
        // The run may already be finalized.
      }
      return { status: "failed" as const };
    }
  },
});

/**
 * Stops a run. Waiting-for-approval runs finalize immediately; a running action
 * notices the flag on its next step or stream chunk and stops itself.
 */
export const cancelRun = action({
  args: { runId: v.id("agentRuns"), sessionId: v.string() },
  returns: v.object({ status: runStatusResult }),
  handler: async (ctx, { runId, sessionId }): Promise<{ status: RunStatus }> => {
    await ctx.runQuery(internal.ownership.assertRunAccess, { runId, sessionId });
    const result = await ctx.runMutation(internal.agent.requestCancel, { runId });
    return { status: result.status };
  },
});
