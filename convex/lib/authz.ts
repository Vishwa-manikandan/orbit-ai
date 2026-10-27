/**
 * Conversation isolation.
 *
 * This workspace has no sign-in, so the boundary is a random session id that
 * the browser keeps in local storage. It stops one browser session from reading
 * or driving another session's conversations, runs, and approvals. It is *not*
 * authentication: a caller who knows another session id can use it. Replace
 * `resolvePrincipal` with the real auth provider's user id when auth lands —
 * every call site already funnels through it.
 */
export type Principal = { sessionId: string };

const SESSION_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function resolvePrincipal(sessionId: string | undefined): Principal {
  if (!sessionId || !SESSION_PATTERN.test(sessionId)) {
    throw new Error("A valid session id is required for this request.");
  }
  return { sessionId };
}

/**
 * Rows created before ownership existed have no `ownerId`. They stay reachable
 * so a local demo isn't stranded, and the seed claims them for the first
 * session that boots.
 */
export function ownsThread(
  thread: { ownerId?: string },
  principal: Principal,
): boolean {
  return !thread.ownerId || thread.ownerId === principal.sessionId;
}

export function assertThreadOwner(
  thread: { ownerId?: string },
  principal: Principal,
): void {
  if (!ownsThread(thread, principal)) {
    throw new Error("This conversation belongs to a different session.");
  }
}
