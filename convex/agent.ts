import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  duplicateSubmission,
  duplicateSubmissionMessage,
  isStaleRun,
} from "./lib/runGuard";

export const startRun = internalMutation({
  args: {
    threadId: v.id("threads"),
    text: v.string(),
    /** Planner that will handle this run; replaced if the model fails. */
    provider: v.optional(v.string()),
    /**
     * False when replaying an existing user message (edit or regenerate): the
     * message is already in the thread and must not be duplicated.
     */
    announceUserMessage: v.optional(v.boolean()),
  },
  handler: async (ctx, { threadId, text, provider, announceUserMessage }) => {
    const announce = announceUserMessage !== false;
    const thread = await ctx.db.get(threadId);
    if (!thread) throw new Error("Conversation not found.");

    const recentRuns = await ctx.db
      .query("agentRuns")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .order("desc")
      .take(5);
    const now = Date.now();
    const blocking = duplicateSubmission(recentRuns, now);
    if (blocking) throw new Error(duplicateSubmissionMessage(blocking.status));

    // Reap a run an interrupted action left behind, so one crash doesn't lock
    // the conversation permanently.
    for (const run of recentRuns.filter((candidate) => isStaleRun(candidate, now))) {
      await ctx.db.patch(run._id, {
        status: "failed",
        error: "This run was interrupted before it could finish.",
        errorCode: "internal",
        completedAt: now,
      });
    }

    const previousUserMessage = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .filter((q) => q.eq(q.field("role"), "user"))
      .first();
    const runId = await ctx.db.insert("agentRuns", {
      threadId,
      prompt: text,
      status: "running",
      provider: provider ?? "pending",
      plan: [],
      nextStep: 0,
      activity: "Planning the request…",
      turns: 0,
      createdAt: now,
    });
    if (announce) {
      await ctx.db.insert("messages", {
        threadId,
        role: "user",
        content: text,
        runId,
        createdAt: now,
      });
    }
    const title =
      previousUserMessage || !announce
        ? thread.title
        : text.replace(/\s+/g, " ").slice(0, 64).trim() || "New conversation";
    await ctx.db.patch(threadId, { title, updatedAt: now });
    await ctx.db.insert("auditEvents", {
      actor: "user",
      action: "run.started",
      subject: text.slice(0, 120),
      subjectId: runId,
      detail: "Request accepted by the orchestration loop.",
      createdAt: now,
    });
    return { runId };
  },
});

export const setPlan = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    plan: v.array(
      v.object({ tool: v.string(), args: v.any(), rationale: v.string() }),
    ),
    provider: v.string(),
    /** Multi-turn runs append; a single-turn plan replaces. */
    append: v.optional(v.boolean()),
  },
  handler: async (ctx, { runId, plan, provider, append }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    await ctx.db.patch(runId, {
      plan: append ? [...run.plan, ...plan] : plan,
      provider,
    });
  },
});

export const setActivity = internalMutation({
  args: { runId: v.id("agentRuns"), activity: v.string(), turns: v.optional(v.number()) },
  handler: async (ctx, { runId, activity, turns }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "running") return;
    await ctx.db.patch(runId, {
      activity: activity.slice(0, 160),
      ...(typeof turns === "number" ? { turns } : {}),
    });
  },
});

export const startExecution = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    stepIndex: v.number(),
    tool: v.string(),
    args: v.any(),
    requiresApproval: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("executions", {
      runId: args.runId,
      stepIndex: args.stepIndex,
      tool: args.tool,
      args: args.args,
      status: args.requiresApproval ? "awaiting_approval" : "running",
      requiresApproval: args.requiresApproval,
      createdAt: Date.now(),
    });
  },
});

export const finishExecution = internalMutation({
  args: {
    executionId: v.id("executions"),
    status: v.union(
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("awaiting_approval"),
      v.literal("rejected"),
    ),
    summary: v.optional(v.string()),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    attempts: v.optional(v.number()),
    nextStep: v.optional(v.number()),
  },
  handler: async (ctx, { executionId, nextStep, ...patch }) => {
    const execution = await ctx.db.get(executionId);
    if (!execution) throw new Error("Execution not found.");
    const now = Date.now();
    await ctx.db.patch(executionId, { ...patch, completedAt: now });
    if (patch.status === "succeeded" || patch.status === "failed") {
      await ctx.db.insert("auditEvents", {
        actor: "agent",
        action: patch.status === "succeeded" ? "tool.succeeded" : "tool.failed",
        subject: execution.tool,
        subjectId: executionId,
        detail: (patch.summary ?? patch.error ?? "").slice(0, 500),
        createdAt: now,
      });
    }
    if (typeof nextStep === "number") {
      await ctx.db.patch(execution.runId, { nextStep });
    }
  },
});

/** Insert the assistant message that streamed deltas will fill in. */
export const beginAssistantMessage = internalMutation({
  args: { runId: v.id("agentRuns"), threadId: v.id("threads") },
  handler: async (ctx, { runId, threadId }) => {
    return await ctx.db.insert("messages", {
      threadId,
      role: "assistant",
      content: "",
      runId,
      createdAt: Date.now(),
    });
  },
});

export const updateAssistantText = internalMutation({
  args: { messageId: v.id("messages"), content: v.string() },
  handler: async (ctx, { messageId, content }) => {
    const message = await ctx.db.get(messageId);
    if (!message) return;
    await ctx.db.patch(messageId, { content: content.slice(0, 20_000) });
  },
});

export const deleteMessage = internalMutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    if (message) await ctx.db.delete(messageId);
  },
});

export const cancelState = internalQuery({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    return run?.cancelRequested ?? false;
  },
});

/**
 * Mark a run for cancellation. A run that is only waiting for approval has
 * nothing executing, so it is finalized here; a running action notices the flag
 * and stops itself.
 */
export const requestCancel = internalMutation({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error("Run not found.");
    if (run.status !== "running" && run.status !== "awaiting_approval") {
      return { status: run.status };
    }

    const now = Date.now();
    await ctx.db.patch(runId, { cancelRequested: true });
    if (run.status !== "awaiting_approval") return { status: "running" as const };

    const approval = await ctx.db
      .query("approvals")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .first();
    if (approval && approval.status === "pending") {
      await ctx.db.patch(approval._id, {
        status: "rejected",
        decidedAt: now,
        note: "Cancelled by user.",
      });
      await ctx.db.patch(approval.executionId, {
        status: "rejected",
        completedAt: now,
        error: "Cancelled by user.",
      });
    }

    await ctx.db.patch(runId, {
      status: "cancelled",
      summary: "Stopped at your request.",
      activity: undefined,
      completedAt: now,
    });
    await ctx.db.insert("messages", {
      threadId: run.threadId,
      role: "assistant",
      content: "Stopped — nothing was executed.",
      runId,
      createdAt: now,
    });
    await ctx.db.insert("auditEvents", {
      actor: "user",
      action: "run.cancelled",
      subject: run.prompt.slice(0, 120),
      subjectId: runId,
      detail: "Cancelled while waiting for approval; no tool ran.",
      createdAt: now,
    });
    await ctx.db.patch(run.threadId, { updatedAt: now });
    return { status: "cancelled" as const };
  },
});

/** Finalize a run that stopped itself. Keeps any streamed text. */
export const stopRun = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    messageId: v.optional(v.id("messages")),
    partial: v.optional(v.string()),
  },
  handler: async (ctx, { runId, messageId, partial }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      return;
    }

    const now = Date.now();
    const text = (partial ?? "").trim();
    const content = text ? `${text}\n\n_Stopped at your request._` : "Stopped at your request.";

    await ctx.db.patch(runId, {
      status: "cancelled",
      summary: content,
      cancelRequested: true,
      activity: undefined,
      completedAt: now,
    });

    if (messageId) {
      const message = await ctx.db.get(messageId);
      if (message) await ctx.db.patch(messageId, { content });
      else
        await ctx.db.insert("messages", {
          threadId: run.threadId,
          role: "assistant",
          content,
          runId,
          createdAt: now,
        });
    } else {
      await ctx.db.insert("messages", {
        threadId: run.threadId,
        role: "assistant",
        content,
        runId,
        createdAt: now,
      });
    }

    await ctx.db.insert("auditEvents", {
      actor: "user",
      action: "run.cancelled",
      subject: run.prompt.slice(0, 120),
      subjectId: runId,
      detail: text ? "Stopped mid-answer; partial text kept." : "Stopped before answering.",
      createdAt: now,
    });
    await ctx.db.patch(run.threadId, { updatedAt: now });
  },
});

export const pauseForApproval = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    executionId: v.id("executions"),
    stepIndex: v.number(),
    title: v.string(),
    detail: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found.");
    const now = Date.now();
    const existing = await ctx.db
      .query("approvals")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .first();
    let approvalId = existing?._id;
    if (!approvalId) {
      const execution = await ctx.db.get(args.executionId);
      approvalId = await ctx.db.insert("approvals", {
        runId: args.runId,
        executionId: args.executionId,
        tool: execution?.tool ?? "unknown",
        args: execution?.args ?? {},
        title: args.title,
        detail: args.detail,
        status: "pending",
        requestedAt: now,
      });
    }
    await ctx.db.patch(args.runId, {
      status: "awaiting_approval",
      nextStep: args.stepIndex,
    });
    await ctx.db.insert("messages", {
      threadId: run.threadId,
      role: "assistant",
      content: args.message,
      runId: args.runId,
      approvalId,
      createdAt: now,
    });
    await ctx.db.insert("auditEvents", {
      actor: "agent",
      action: "approval.requested",
      subject: args.title,
      subjectId: approvalId,
      detail: args.detail.slice(0, 500),
      createdAt: now,
    });
    await ctx.db.patch(run.threadId, { updatedAt: now });
    return { approvalId };
  },
});

export const completeRun = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    summary: v.string(),
    suggestions: v.optional(v.array(v.string())),
    turns: v.optional(v.number()),
    provider: v.optional(v.string()),
    /** Present when the answer was already streamed into a message. */
    messageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, { runId, summary, suggestions, turns, provider, messageId }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status === "completed" || run.status === "failed") return;
    const now = Date.now();
    await ctx.db.patch(runId, {
      status: "completed",
      summary,
      activity: undefined,
      completedAt: now,
      ...(suggestions && suggestions.length > 0 ? { suggestions } : {}),
      ...(typeof turns === "number" ? { turns } : {}),
      ...(provider ? { provider } : {}),
    });
    if (messageId) {
      const message = await ctx.db.get(messageId);
      if (message) await ctx.db.patch(messageId, { content: summary });
      else
        await ctx.db.insert("messages", {
          threadId: run.threadId,
          role: "assistant",
          content: summary,
          runId,
          createdAt: now,
        });
    } else {
      await ctx.db.insert("messages", {
        threadId: run.threadId,
        role: "assistant",
        content: summary,
        runId,
        createdAt: now,
      });
    }
    await ctx.db.insert("auditEvents", {
      actor: "agent",
      action: "run.completed",
      subject: run.prompt.slice(0, 120),
      subjectId: runId,
      detail: `${run.plan.length} step${run.plan.length === 1 ? "" : "s"} planned.`,
      createdAt: now,
    });
    await ctx.db.patch(run.threadId, { updatedAt: now });
  },
});

export const failRun = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    error: v.string(),
    userMessage: v.string(),
    errorCode: v.optional(v.string()),
    turns: v.optional(v.number()),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, { runId, error, userMessage, errorCode, turns, provider }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status === "completed" || run.status === "failed") return;
    const now = Date.now();
    await ctx.db.patch(runId, {
      status: "failed",
      error,
      activity: undefined,
      completedAt: now,
      ...(errorCode ? { errorCode } : {}),
      ...(typeof turns === "number" ? { turns } : {}),
      ...(provider ? { provider } : {}),
    });
    await ctx.db.insert("messages", {
      threadId: run.threadId,
      role: "assistant",
      content: userMessage,
      runId,
      createdAt: now,
    });
    await ctx.db.insert("auditEvents", {
      actor: "agent",
      action: "run.failed",
      subject: run.prompt.slice(0, 120),
      subjectId: runId,
      detail: error.slice(0, 500),
      createdAt: now,
    });
    await ctx.db.patch(run.threadId, { updatedAt: now });
  },
});

export const markRunning = internalMutation({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, { runId }) => {
    await ctx.db.patch(runId, { status: "running" });
  },
});

export const runExecutions = internalQuery({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query("executions")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .order("asc")
      .collect();
  },
});

export const resumeState = internalQuery({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    const approval = await ctx.db
      .query("approvals")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .first();
    const execution = approval ? await ctx.db.get(approval.executionId) : null;
    return { run, approval, execution };
  },
});

