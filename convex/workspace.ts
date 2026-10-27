import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { ownedThreadIds } from "./ownership";
import type { CalendarEvent, Draft, FollowUp, MailThread } from "./lib/types";

function mapMail(doc: Doc<"mailThreads">): MailThread {
  return {
    id: doc._id,
    from: doc.from,
    fromEmail: doc.fromEmail,
    subject: doc.subject,
    snippet: doc.snippet,
    unread: doc.unread,
    needsAttention: doc.needsAttention,
    labels: doc.labels,
    receivedAt: doc.receivedAt,
    messages: doc.messages,
  };
}

function mapDraft(doc: Doc<"drafts">): Draft {
  return {
    id: doc._id,
    threadId: doc.mailThreadId,
    subject: doc.subject,
    body: doc.body,
    status: doc.status,
    createdAt: doc.createdAt,
  };
}

function mapEvent(doc: Doc<"calendarEvents">): CalendarEvent {
  return {
    id: doc._id,
    title: doc.title,
    start: doc.start,
    end: doc.end,
    location: doc.location,
    attendees: doc.attendees,
    description: doc.description,
    agenda: doc.agenda,
  };
}

function mapTask(doc: Doc<"tasks">): FollowUp {
  return {
    id: doc._id,
    title: doc.title,
    status: doc.status,
    dueAt: doc.dueAt,
    source: doc.source,
  };
}

async function searchMailDocs(
  ctx: { db: any },
  input: { query?: string; needsAttention?: boolean; limit?: number },
) {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
  const docs = (await ctx.db
    .query("mailThreads")
    .withIndex("by_receivedAt")
    .order("desc")
    .collect()) as Doc<"mailThreads">[];
  const needle = input.query?.trim().toLowerCase();
  return docs
    .filter((doc) => (input.needsAttention ? doc.needsAttention : true))
    .filter((doc) => {
      if (!needle) return true;
      const haystack = [
        doc.from,
        doc.fromEmail,
        doc.subject,
        doc.snippet,
        ...doc.messages.map((m) => m.body),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    })
    .slice(0, limit);
}

export const searchMail = internalQuery({
  args: {
    query: v.optional(v.string()),
    needsAttention: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => (await searchMailDocs(ctx, args)).map(mapMail),
});

export const getMailThread = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.get(id as Doc<"mailThreads">["_id"]);
    return doc ? mapMail(doc) : null;
  },
});

export const createDraft = internalMutation({
  args: {
    threadId: v.string(),
    subject: v.string(),
    body: v.string(),
    runId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const threadId = ctx.db.normalizeId("mailThreads", args.threadId);
    if (!threadId) throw new Error("Thread not found.");
    const runId = args.runId ? ctx.db.normalizeId("agentRuns", args.runId) : null;
    const id = await ctx.db.insert("drafts", {
      mailThreadId: threadId,
      subject: args.subject.slice(0, 300),
      body: args.body.slice(0, 8000),
      status: "draft",
      createdAt: Date.now(),
      ...(runId ? { runId } : {}),
    });
    const doc = await ctx.db.get(id);
    if (!doc) throw new Error("Draft could not be created.");
    return mapDraft(doc);
  },
});

export const getDraft = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.get(id as Doc<"drafts">["_id"]);
    return doc ? mapDraft(doc) : null;
  },
});

export const sendDraft = internalMutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const draftId = ctx.db.normalizeId("drafts", id);
    if (!draftId) throw new Error("Draft not found.");
    const draft = await ctx.db.get(draftId);
    if (!draft) throw new Error("Draft not found.");
    if (draft.status === "sent") throw new Error("Draft was already sent.");
    const thread = await ctx.db.get(draft.mailThreadId);
    if (!thread) throw new Error("Thread not found.");
    const sentAt = Date.now();
    await ctx.db.patch(draftId, { status: "sent", sentAt });
    await ctx.db.patch(thread._id, {
      messages: [
        ...thread.messages,
        { from: "Alex Rivera", body: draft.body, sentAt },
      ],
      needsAttention: false,
      unread: false,
    });
    return {
      draftId,
      to: thread.fromEmail,
      subject: draft.subject,
      sentAt,
    };
  },
});

export const listEvents = internalQuery({
  args: { days: v.number(), now: v.number() },
  handler: async (ctx, { days, now }) => {
    const end = now + days * 24 * 60 * 60 * 1000;
    const docs = await ctx.db
      .query("calendarEvents")
      .withIndex("by_start", (q) => q.gte("start", now - 60 * 60 * 1000).lt("start", end))
      .collect();
    return docs.map(mapEvent);
  },
});

export const getEvent = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.get(id as Doc<"calendarEvents">["_id"]);
    return doc ? mapEvent(doc) : null;
  },
});

export const createFollowUp = internalMutation({
  args: {
    title: v.string(),
    dueAt: v.optional(v.number()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("tasks", {
      title: args.title.slice(0, 200),
      status: "open",
      dueAt: args.dueAt,
      source: args.source,
      createdAt: Date.now(),
    });
    const doc = await ctx.db.get(id);
    if (!doc) throw new Error("Follow-up could not be created.");
    return mapTask(doc);
  },
});

export const listFollowUps = internalQuery({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("tasks").order("desc").take(30);
    return docs.map(mapTask);
  },
});

export const getAgentContext = internalQuery({
  args: { threadId: v.id("threads"), runId: v.optional(v.id("agentRuns")) },
  handler: async (ctx, { threadId, runId }) => {
    const now = Date.now();
    const mailDocs = await ctx.db
      .query("mailThreads")
      .withIndex("by_receivedAt")
      .order("desc")
      .take(10);
    const draftDocs = await ctx.db
      .query("drafts")
      .withIndex("by_status", (q) => q.eq("status", "draft"))
      .order("desc")
      .take(3);
    const eventDocs = await ctx.db
      .query("calendarEvents")
      .withIndex("by_start", (q) => q.gte("start", now - 60 * 60 * 1000))
      .take(8);
    const taskDocs = await ctx.db.query("tasks").order("desc").take(20);
    const messageDocs = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .order("desc")
      .take(10);

    // Tool results from the most recent finished run in this conversation, so a
    // follow-up like "and the second one?" has something to resolve against.
    const threadRuns = await ctx.db
      .query("agentRuns")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .order("desc")
      .take(4);
    const previousRun = threadRuns.find(
      (item) =>
        item._id !== runId && (item.status === "completed" || item.status === "failed"),
    );
    const priorExecutions = previousRun
      ? await ctx.db
          .query("executions")
          .withIndex("by_run", (q) => q.eq("runId", previousRun._id))
          .order("asc")
          .take(8)
      : [];

    return {
      now,
      mail: mailDocs.map(mapMail),
      drafts: draftDocs.map(mapDraft),
      events: eventDocs.map(mapEvent),
      tasks: taskDocs.map(mapTask),
      recentMessages: messageDocs
        .reverse()
        .map((m) => ({ role: m.role, content: m.content })),
      priorObservations: priorExecutions
        .filter((execution) => execution.status === "succeeded")
        .map((execution) => ({
          stepIndex: execution.stepIndex,
          tool: execution.tool,
          args: execution.args,
          ok: true as const,
          summary: execution.summary ?? "",
          data: execution.result,
        })),
    };
  },
});

export const sidebar = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const now = Date.now();
    const allowedThreads = await ownedThreadIds(ctx, sessionId);
    const events = await ctx.db
      .query("calendarEvents")
      .withIndex("by_start", (q) => q.gte("start", now - 60 * 60 * 1000))
      .take(4);
    const mailDocs = await ctx.db
      .query("mailThreads")
      .withIndex("by_receivedAt")
      .order("desc")
      .take(10);
    const drafts = await ctx.db
      .query("drafts")
      .withIndex("by_status", (q) => q.eq("status", "draft"))
      .order("desc")
      .take(1);
    const pendingDocs = await ctx.db
      .query("approvals")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(10);
    // Pending work is shown only for conversations this session owns.
    const pendingApprovals = [];
    for (const approval of pendingDocs) {
      const run = await ctx.db.get(approval.runId);
      if (run && allowedThreads.has(run.threadId)) pendingApprovals.push(approval);
    }
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .take(5);
    const audit = await ctx.db.query("auditEvents").order("desc").take(6);
    const attention = mailDocs.filter((m) => m.needsAttention).slice(0, 4);

    return {
      now,
      events: events.map(mapEvent),
      attention: attention.map((m) => ({
        id: m._id,
        from: m.from,
        subject: m.subject,
        snippet: m.snippet,
        receivedAt: m.receivedAt,
      })),
      draft: drafts[0] ? mapDraft(drafts[0]) : null,
      pendingApprovals: pendingApprovals.map((a) => ({
        id: a._id,
        title: a.title,
        requestedAt: a.requestedAt,
        runId: a.runId,
      })),
      tasks: tasks.map(mapTask),
      audit,
      counts: {
        attention: mailDocs.filter((m) => m.needsAttention).length,
        pendingApprovals: pendingApprovals.length,
        openTasks: tasks.length,
      },
    };
  },
});
