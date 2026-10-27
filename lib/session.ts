const STORAGE_KEY = "orbit.session";
const SESSION_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Conversation isolation key. It lives in local storage so a reload keeps the
 * same conversations, and it is sent with every thread-scoped request where the
 * server checks that the thread belongs to it. This is an isolation boundary,
 * not authentication — see `convex/lib/authz.ts`.
 */
export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && SESSION_PATTERN.test(existing)) return existing;
  } catch {
    // Private-mode storage failures fall through to an in-memory id.
  }
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : `s${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // The id still works for this page load.
  }
  return id;
}
