import { v } from "convex/values";
import { query } from "./_generated/server";
import { ownsThread, resolvePrincipal } from "./lib/authz";

export const getThread = query({
  args: { threadId: v.id("threads"), sessionId: v.string() },
  handler: async (ctx, { threadId, sessionId }) => {
    const thread = await ctx.db.get(threadId);
    // Missing and not-yours look the same from the outside: no data leak.
    if (!thread || !ownsThread(thread, resolvePrincipal(sessionId))) return null;

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .order("asc")
      .collect();

    const runs: Record<
      string,
      {
        run: {
          id: string;
          status: "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
          provider: string;
          prompt: string;
          summary?: string;
          error?: string;
          errorCode?: string;
          activity?: string;
          suggestions?: string[];
          turns?: number;
          cancelRequested?: boolean;
          createdAt: number;
          completedAt?: number;
          plan: { tool: string; args: unknown; rationale: string }[];
        };
        executions: {
          id: string;
          stepIndex: number;
          tool: string;
          args: unknown;
          status: "running" | "succeeded" | "failed" | "awaiting_approval" | "rejected";
          requiresApproval: boolean;
          result?: unknown;
          summary?: string;
          error?: string;
          durationMs?: number;
          attempts?: number;
          createdAt: number;
          completedAt?: number;
        }[];
        approval: {
          id: string;
          title: string;
          detail: string;
          status: "pending" | "approved" | "rejected";
          requestedAt: number;
          decidedAt?: number;
        } | null;
      }
    > = {};

    const runIds = [...new Set(messages.flatMap((m) => (m.runId ? [m.runId] : [])))];
    for (const runId of runIds) {
      const run = await ctx.db.get(runId);
      if (!run) continue;
      const executions = await ctx.db
        .query("executions")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .order("asc")
        .collect();
      const approval = await ctx.db
        .query("approvals")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .first();
      runs[runId] = {
        run: {
          id: run._id,
          status: run.status,
          provider: run.provider,
          prompt: run.prompt,
          summary: run.summary,
          error: run.error,
          errorCode: run.errorCode,
          activity: run.activity,
          suggestions: run.suggestions,
          turns: run.turns,
          cancelRequested: run.cancelRequested,
          createdAt: run.createdAt,
          completedAt: run.completedAt,
          plan: run.plan,
        },
        executions: executions.map((e) => ({
          id: e._id,
          stepIndex: e.stepIndex,
          tool: e.tool,
          args: e.args,
          status: e.status,
          requiresApproval: e.requiresApproval,
          result: e.result,
          summary: e.summary,
          error: e.error,
          durationMs: e.durationMs,
          attempts: e.attempts,
          createdAt: e.createdAt,
          completedAt: e.completedAt,
        })),
        approval: approval
          ? {
              id: approval._id,
              title: approval.title,
              detail: approval.detail,
              status: approval.status,
              requestedAt: approval.requestedAt,
              decidedAt: approval.decidedAt,
            }
          : null,
      };
    }

    const pendingApprovals = Object.values(runs)
      .map((r) => r.approval)
      .filter((a): a is NonNullable<typeof a> => Boolean(a && a.status === "pending"));

    return { thread, messages, runs, pendingApprovals };
  },
});
