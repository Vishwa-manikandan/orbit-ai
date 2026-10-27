import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { assertThreadOwner, resolvePrincipal } from "./lib/authz";

/** Thumbs feedback on an answer. Persisted so the choice survives a reload. */
export const setFeedback = mutation({
  args: {
    messageId: v.id("messages"),
    sessionId: v.string(),
    value: v.union(v.literal("up"), v.literal("down"), v.literal("none")),
  },
  handler: async (ctx, { messageId, sessionId, value }) => {
    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("Message not found.");
    const thread = await ctx.db.get(message.threadId);
    if (!thread) throw new Error("Conversation not found.");
    assertThreadOwner(thread, resolvePrincipal(sessionId));

    await ctx.db.patch(messageId, {
      feedback: value === "none" ? undefined : value,
    });
    return { value };
  },
});

/** Deletes a run with everything derived from it. */
async function deleteRun(ctx: MutationCtx, runId: Id<"agentRuns">) {
  const executions = await ctx.db
    .query("executions")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .collect();
  for (const execution of executions) await ctx.db.delete(execution._id);

  const approvals = await ctx.db
    .query("approvals")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .collect();
  for (const approval of approvals) await ctx.db.delete(approval._id);

  await ctx.db.delete(runId);
}

/**
 * Removes every message after `keepId` (and the runs behind them) so the
 * conversation can be replayed from a chosen point. The kept message itself is
 * untouched: callers either rewrite it (edit) or reuse it (regenerate).
 */
async function deleteTail(ctx: MutationCtx, threadId: Id<"threads">, keep: { _id: Id<"messages">; createdAt: number }) {
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .collect();

  const doomed = messages.filter(
    (message) => message._id !== keep._id && message.createdAt >= keep.createdAt,
  );
  const runs = new Set<Id<"agentRuns">>();
  for (const message of doomed) if (message.runId) runs.add(message.runId);
  for (const runId of runs) await deleteRun(ctx, runId);
  for (const message of doomed) await ctx.db.delete(message._id);
}

async function ownedUserMessage(
  ctx: MutationCtx,
  messageId: Id<"messages">,
  sessionId: string,
) {
  const message = await ctx.db.get(messageId);
  if (!message) throw new Error("Message not found.");
  const thread = await ctx.db.get(message.threadId);
  if (!thread) throw new Error("Conversation not found.");
  assertThreadOwner(thread, resolvePrincipal(sessionId));
  if (message.role !== "user") throw new Error("Only your own messages can be edited or retried.");
  return message;
}

/** Rewrites a user message and discards everything that followed it. */
export const editUserMessage = internalMutation({
  args: { messageId: v.id("messages"), text: v.string(), sessionId: v.string() },
  handler: async (ctx, { messageId, text, sessionId }) => {
    const message = await ownedUserMessage(ctx, messageId, sessionId);

    await deleteTail(ctx, message.threadId, message);
    await ctx.db.patch(messageId, { content: text, createdAt: Date.now() });
    await ctx.db.patch(message.threadId, { updatedAt: Date.now() });

    return { threadId: message.threadId, text };
  },
});

/**
 * Discards the answer(s) that followed a user message so the same request can
 * be planned again. The user message itself is kept, so nothing is duplicated.
 */
export const prepareRegenerate = internalMutation({
  args: { messageId: v.id("messages"), sessionId: v.string() },
  handler: async (ctx, { messageId, sessionId }) => {
    const message = await ownedUserMessage(ctx, messageId, sessionId);

    await deleteTail(ctx, message.threadId, message);
    await ctx.db.patch(message.threadId, { updatedAt: Date.now() });

    return { threadId: message.threadId, text: message.content };
  },
});
