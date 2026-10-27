import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const runStatus = v.union(
  v.literal("running"),
  v.literal("awaiting_approval"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

const executionStatus = v.union(
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("awaiting_approval"),
  v.literal("rejected"),
);

const approvalStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
);

export const planStep = v.object({
  tool: v.string(),
  args: v.any(),
  rationale: v.string(),
});

export default defineSchema({
  threads: defineTable({
    title: v.string(),
    /** Session that owns this conversation. Absent only on pre-ownership rows. */
    ownerId: v.optional(v.string()),
    /** Set when the user archives the conversation; cleared when restored. */
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_updatedAt", ["updatedAt"])
    .index("by_owner", ["ownerId", "updatedAt"]),

  messages: defineTable({
    threadId: v.id("threads"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    runId: v.optional(v.id("agentRuns")),
    approvalId: v.optional(v.id("approvals")),
    /** Thumbs feedback on an assistant answer. */
    feedback: v.optional(v.union(v.literal("up"), v.literal("down"))),
    createdAt: v.number(),
  }).index("by_thread", ["threadId", "createdAt"]),

  agentRuns: defineTable({
    threadId: v.id("threads"),
    prompt: v.string(),
    status: runStatus,
    provider: v.string(),
    plan: v.array(planStep),
    nextStep: v.number(),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
    /** Short, human-readable progress line, reactive in the UI. */
    activity: v.optional(v.string()),
    /** Follow-up prompts (clarification options) offered with the answer. */
    suggestions: v.optional(v.array(v.string())),
    /**
     * Legacy flag from when a provider failure fell back to the patterns. Runs
     * now fail with a retryable error instead; the field stays so rows written
     * before that change still read cleanly.
     */
    degraded: v.optional(v.boolean()),
    /** Structured failure code for the trace and the activity page. */
    errorCode: v.optional(v.string()),
    /** Planner turns used by this run. */
    turns: v.optional(v.number()),
    /** Set by cancelRun; the running action notices and stops. */
    cancelRequested: v.optional(v.boolean()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_thread", ["threadId", "createdAt"])
    .index("by_status", ["status"]),

  executions: defineTable({
    runId: v.id("agentRuns"),
    stepIndex: v.number(),
    tool: v.string(),
    args: v.any(),
    status: executionStatus,
    requiresApproval: v.boolean(),
    result: v.optional(v.any()),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    attempts: v.optional(v.number()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_run", ["runId", "stepIndex"]),

  approvals: defineTable({
    runId: v.id("agentRuns"),
    executionId: v.id("executions"),
    tool: v.string(),
    args: v.any(),
    title: v.string(),
    detail: v.string(),
    status: approvalStatus,
    requestedAt: v.number(),
    decidedAt: v.optional(v.number()),
    note: v.optional(v.string()),
  })
    .index("by_status", ["status", "requestedAt"])
    .index("by_run", ["runId"]),

  auditEvents: defineTable({
    actor: v.string(),
    action: v.string(),
    subject: v.string(),
    subjectId: v.optional(v.string()),
    detail: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  // Mock integration data. In production these tables are replaced by the
  // Gmail and Google Calendar adapters described in the README.
  mailThreads: defineTable({
    externalId: v.string(),
    from: v.string(),
    fromEmail: v.string(),
    subject: v.string(),
    snippet: v.string(),
    unread: v.boolean(),
    needsAttention: v.boolean(),
    labels: v.array(v.string()),
    receivedAt: v.number(),
    messages: v.array(
      v.object({
        from: v.string(),
        body: v.string(),
        sentAt: v.number(),
      }),
    ),
  })
    .index("by_receivedAt", ["receivedAt"])
    .index("by_externalId", ["externalId"]),

  drafts: defineTable({
    mailThreadId: v.id("mailThreads"),
    subject: v.string(),
    body: v.string(),
    status: v.union(v.literal("draft"), v.literal("sent")),
    createdAt: v.number(),
    sentAt: v.optional(v.number()),
    runId: v.optional(v.id("agentRuns")),
  }).index("by_status", ["status", "createdAt"]),

  calendarEvents: defineTable({
    externalId: v.string(),
    title: v.string(),
    start: v.number(),
    end: v.number(),
    location: v.string(),
    attendees: v.array(v.object({ name: v.string(), email: v.string() })),
    description: v.string(),
    agenda: v.optional(v.array(v.string())),
  }).index("by_start", ["start"]),

  tasks: defineTable({
    title: v.string(),
    status: v.union(v.literal("open"), v.literal("done")),
    dueAt: v.optional(v.number()),
    source: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_status", ["status", "createdAt"]),

  appMeta: defineTable({
    key: v.string(),
    seededAt: v.number(),
  }).index("by_key", ["key"]),
});
