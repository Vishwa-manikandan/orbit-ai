import { v } from "convex/values";
import { query } from "./_generated/server";
import { ownedThreadIds } from "./ownership";

export const list = query({
  args: { limit: v.optional(v.number()), sessionId: v.string() },
  handler: async (ctx, { limit, sessionId }) => {
    const take = Math.min(Math.max(limit ?? 25, 1), 50);
    const allowedThreads = await ownedThreadIds(ctx, sessionId);
    const runs = (await ctx.db.query("agentRuns").order("desc").take(take * 3))
      .filter((run) => allowedThreads.has(run.threadId))
      .slice(0, take);

    const enriched = [];
    for (const run of runs) {
      const thread = await ctx.db.get(run.threadId);
      const executions = await ctx.db
        .query("executions")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .order("asc")
        .collect();
      enriched.push({
        id: run._id,
        prompt: run.prompt,
        status: run.status,
        provider: run.provider,
        summary: run.summary,
        error: run.error,
        errorCode: run.errorCode,
        turns: run.turns,
        activity: run.activity,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        threadId: run.threadId,
        threadTitle: thread?.title ?? "Conversation",
        executions: executions.map((e) => ({
          id: e._id,
          stepIndex: e.stepIndex,
          tool: e.tool,
          args: e.args,
          status: e.status,
          requiresApproval: e.requiresApproval,
          summary: e.summary,
          result: e.result,
          error: e.error,
          durationMs: e.durationMs,
          attempts: e.attempts,
          createdAt: e.createdAt,
          completedAt: e.completedAt,
        })),
      });
    }

    const allRuns = (await ctx.db.query("agentRuns").order("desc").take(200)).filter((run) =>
      allowedThreads.has(run.threadId),
    );
    const completed = allRuns.filter((r) => r.status === "completed").length;
    const failed = allRuns.filter((r) => r.status === "failed").length;
    const awaiting = allRuns.filter((r) => r.status === "awaiting_approval").length;
    const finished = completed + failed;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const runsToday = allRuns.filter((r) => r.createdAt >= startOfDay.getTime()).length;

    const audit = await ctx.db.query("auditEvents").order("desc").take(80);

    return {
      runs: enriched,
      stats: {
        total: allRuns.length,
        completed,
        failed,
        awaiting,
        successRate: finished === 0 ? null : Math.round((completed / finished) * 100),
        runsToday,
      },
      audit,
    };
  },
});
