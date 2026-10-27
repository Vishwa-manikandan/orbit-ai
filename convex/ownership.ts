import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { assertThreadOwner, ownsThread, resolvePrincipal } from "./lib/authz";

/** Thread ids this session may read. Legacy unowned rows are adopted by seed. */
export async function ownedThreadIds(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
): Promise<Set<string>> {
  const principal = resolvePrincipal(sessionId);
  const threads = await ctx.db.query("threads").collect();
  return new Set(
    threads.filter((thread) => ownsThread(thread, principal)).map((thread) => thread._id),
  );
}

export async function assertRunOwner(
  ctx: QueryCtx | MutationCtx,
  runId: Id<"agentRuns">,
  sessionId: string,
) {
  const run = await ctx.db.get(runId);
  if (!run) throw new Error("Run not found.");
  const thread = await ctx.db.get(run.threadId);
  if (!thread) throw new Error("Conversation not found.");
  assertThreadOwner(thread, resolvePrincipal(sessionId));
  return { run, thread };
}

/** Action-side checks: actions can't touch the database directly. */
export const assertThreadAccess = internalQuery({
  args: { threadId: v.id("threads"), sessionId: v.string() },
  handler: async (ctx, { threadId, sessionId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread) throw new Error("Conversation not found.");
    assertThreadOwner(thread, resolvePrincipal(sessionId));
    return thread._id;
  },
});

export const assertRunAccess = internalQuery({
  args: { runId: v.id("agentRuns"), sessionId: v.string() },
  handler: async (ctx, { runId, sessionId }) => {
    const { run, thread } = await assertRunOwner(ctx, runId, sessionId);
    return { runId: run._id, threadId: thread._id, prompt: run.prompt, plan: run.plan };
  },
});
