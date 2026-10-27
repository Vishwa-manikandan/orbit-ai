import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertRunOwner, ownedThreadIds } from "./ownership";

export const list = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const allowedThreads = await ownedThreadIds(ctx, sessionId);

    const pending = await ctx.db
      .query("approvals")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("asc")
      .take(20);

    const all = await ctx.db.query("approvals").order("desc").take(30);
    const decided = all.filter((a) => a.status !== "pending").slice(0, 12);

    async function enrich(items: typeof all) {
      const result = [];
      for (const approval of items) {
        const run = await ctx.db.get(approval.runId);
        if (!run || !allowedThreads.has(run.threadId)) continue;
        const thread = await ctx.db.get(run.threadId);
        result.push({
          id: approval._id,
          title: approval.title,
          detail: approval.detail,
          tool: approval.tool,
          args: approval.args,
          status: approval.status,
          requestedAt: approval.requestedAt,
          decidedAt: approval.decidedAt,
          runId: approval.runId,
          threadId: run.threadId,
          threadTitle: thread?.title ?? "Conversation",
          prompt: run.prompt,
        });
      }
      return result;
    }

    return { pending: await enrich(pending), decided: await enrich(decided) };
  },
});

export const pendingCount = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const allowedThreads = await ownedThreadIds(ctx, sessionId);
    const pending = await ctx.db
      .query("approvals")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(50);
    let count = 0;
    for (const approval of pending) {
      const run = await ctx.db.get(approval.runId);
      if (run && allowedThreads.has(run.threadId)) count += 1;
    }
    return count;
  },
});

export const decide = mutation({
  args: {
    approvalId: v.id("approvals"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    note: v.optional(v.string()),
    sessionId: v.string(),
  },
  handler: async (ctx, { approvalId, decision, note, sessionId }) => {
    const approval = await ctx.db.get(approvalId);
    if (!approval) throw new Error("Approval not found.");
    // Authorization first: a decision from another session must not touch it.
    await assertRunOwner(ctx, approval.runId, sessionId);

    if (approval.status !== "pending") throw new Error("This approval was already decided.");

    const now = Date.now();
    await ctx.db.patch(approvalId, {
      status: decision,
      decidedAt: now,
      ...(note ? { note: note.slice(0, 500) } : {}),
    });

    await ctx.db.insert("auditEvents", {
      actor: "user",
      action: decision === "approved" ? "approval.granted" : "approval.rejected",
      subject: approval.title,
      subjectId: approval._id,
      detail:
        decision === "approved"
          ? "Approved from the approvals panel. Execution resumed."
          : "Declined. The tool was not executed.",
      createdAt: now,
    });

    if (decision === "rejected") {
      await ctx.db.patch(approval.executionId, {
        status: "rejected",
        completedAt: now,
        error: "Rejected by user.",
      });
      const run = await ctx.db.get(approval.runId);
      if (run) {
        await ctx.db.patch(run._id, {
          status: "completed",
          summary: `Declined: ${approval.title}`,
          completedAt: now,
        });
        await ctx.db.insert("messages", {
          threadId: run.threadId,
          role: "assistant",
          content: `Cancelled — **${approval.title}** was not executed. No changes were made.`,
          runId: run._id,
          approvalId,
          createdAt: now,
        });
        await ctx.db.patch(run.threadId, { updatedAt: now });
      }
      return { status: decision, execute: false as const };
    }

    return { status: decision, execute: true as const };
  },
});
