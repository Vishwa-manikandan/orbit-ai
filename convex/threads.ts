import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertThreadOwner } from "./lib/authz";
import { resolvePrincipal } from "./lib/authz";

/**
 * Conversations for one session. Search matches the title and every message in
 * the thread, so a phrase from deep in a conversation still finds it; archived
 * threads are excluded unless the caller asks for them.
 */
export const list = query({
  args: {
    sessionId: v.string(),
    query: v.optional(v.string()),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, { sessionId, query: search, archived }) => {
    const principal = resolvePrincipal(sessionId);
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_owner", (q) => q.eq("ownerId", principal.sessionId))
      .order("desc")
      .take(80);

    const needle = search?.trim().toLowerCase();
    const wantArchived = Boolean(archived);
    const result = [];

    for (const thread of threads) {
      const isArchived = Boolean(thread.archivedAt);
      if (isArchived !== wantArchived) continue;

      const messages = await ctx.db
        .query("messages")
        .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
        .order("desc")
        .take(40);

      if (needle) {
        const haystack = [thread.title, ...messages.map((message) => message.content)]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) continue;
      }

      const last = messages[0];
      const titleMatch =
        needle && thread.title.toLowerCase().includes(needle) ? thread.title : undefined;
      result.push({
        id: thread._id,
        title: thread.title,
        updatedAt: thread.updatedAt,
        createdAt: thread.createdAt,
        archived: isArchived,
        archivedAt: thread.archivedAt ?? null,
        preview:
          last?.content.replace(/\s+/g, " ").replace(/[*_`#]/g, "").slice(0, 120) ||
          "No messages yet",
        match: needle ? (titleMatch ?? null) : null,
      });

      if (result.length >= 40) break;
    }

    return result;
  },
});

export const archivedCount = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const principal = resolvePrincipal(sessionId);
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_owner", (q) => q.eq("ownerId", principal.sessionId))
      .take(80);
    return threads.filter((thread) => Boolean(thread.archivedAt)).length;
  },
});

export const create = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const principal = resolvePrincipal(sessionId);
    const now = Date.now();
    return await ctx.db.insert("threads", {
      title: "New conversation",
      ownerId: principal.sessionId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const rename = mutation({
  args: { threadId: v.id("threads"), sessionId: v.string(), title: v.string() },
  handler: async (ctx, { threadId, sessionId, title }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread) throw new Error("Conversation not found.");
    assertThreadOwner(thread, resolvePrincipal(sessionId));

    const clean = title.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!clean) throw new Error("A conversation needs a title.");
    await ctx.db.patch(threadId, { title: clean, updatedAt: Date.now() });
    return clean;
  },
});

export const archive = mutation({
  args: { threadId: v.id("threads"), sessionId: v.string(), archived: v.boolean() },
  handler: async (ctx, { threadId, sessionId, archived }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread) throw new Error("Conversation not found.");
    assertThreadOwner(thread, resolvePrincipal(sessionId));

    await ctx.db.patch(threadId, {
      archivedAt: archived ? Date.now() : undefined,
      updatedAt: thread.updatedAt,
    });
    return { archived };
  },
});

/**
 * Deletes the conversation and everything derived from it. Audit events are
 * intentionally left in place: they are the append-only record of what the
 * agent did, not part of the conversation.
 */
export const remove = mutation({
  args: { threadId: v.id("threads"), sessionId: v.string() },
  handler: async (ctx, { threadId, sessionId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread) throw new Error("Conversation not found.");
    assertThreadOwner(thread, resolvePrincipal(sessionId));

    const runs = await ctx.db
      .query("agentRuns")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .collect();

    for (const run of runs) {
      const executions = await ctx.db
        .query("executions")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .collect();
      for (const execution of executions) await ctx.db.delete(execution._id);

      const approvals = await ctx.db
        .query("approvals")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .collect();
      for (const approval of approvals) await ctx.db.delete(approval._id);

      await ctx.db.delete(run._id);
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .collect();
    for (const message of messages) await ctx.db.delete(message._id);

    await ctx.db.delete(threadId);
    return { deleted: true };
  },
});
