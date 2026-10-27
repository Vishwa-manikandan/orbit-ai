/**
 * Duplicate-submission guard.
 *
 * Two requests for the same conversation must never run the loop at the same
 * time: the second one would plan against state the first is still changing and
 * could repeat a side effect. The check lives server-side (the composer's
 * in-flight flag only covers one tab) and is kept pure so it can be tested
 * without a Convex deployment.
 */

/** Convex actions are killed well before this, so an older run cannot be alive. */
export const STALE_RUN_MS = 15 * 60 * 1000;

export type RunSummary = {
  status: string;
  createdAt: number;
};

export function isActiveRun(run: RunSummary, now: number): boolean {
  // A pending approval waits for a human, so age never expires it: the decision
  // must be made before the conversation moves on.
  if (run.status === "awaiting_approval") return true;
  return run.status === "running" && now - run.createdAt <= STALE_RUN_MS;
}

/**
 * A run left behind by an interrupted action (deploy, timeout, crash) would
 * otherwise block its conversation forever. It is reaped on the next request.
 */
export function isStaleRun(run: RunSummary, now: number): boolean {
  return run.status === "running" && now - run.createdAt > STALE_RUN_MS;
}

export function duplicateSubmissionMessage(status: string): string {
  return status === "awaiting_approval"
    ? "There's a pending approval in this conversation. Approve or decline it before sending another request."
    : "Orbit is still working on the previous message.";
}

export function duplicateSubmission(
  runs: RunSummary[],
  now: number,
): { status: "running" | "awaiting_approval" } | null {
  const active = runs.find((run) => isActiveRun(run, now));
  if (!active) return null;
  return { status: active.status as "running" | "awaiting_approval" };
}
