import { describe, expect, it } from "vitest";
import {
  assertThreadOwner,
  ownsThread,
  resolvePrincipal,
} from "@/convex/lib/authz";

/**
 * The conversation boundary: a request may only read or drive the conversations
 * its own session owns. These are the checks every action funnels through.
 */
describe("conversation authorization", () => {
  const owner = resolvePrincipal("session_aaaaaaaaaaaaaaaa");
  const other = resolvePrincipal("session_bbbbbbbbbbbbbbbb");

  it("rejects a missing or malformed session id", () => {
    expect(() => resolvePrincipal(undefined)).toThrow(/session id/i);
    expect(() => resolvePrincipal("short")).toThrow(/session id/i);
    expect(() => resolvePrincipal("not a session id!!!")).toThrow(/session id/i);
  });

  it("lets the owning session through", () => {
    expect(ownsThread({ ownerId: owner.sessionId }, owner)).toBe(true);
    expect(() => assertThreadOwner({ ownerId: owner.sessionId }, owner)).not.toThrow();
  });

  it("refuses another session's conversation", () => {
    expect(ownsThread({ ownerId: owner.sessionId }, other)).toBe(false);
    expect(() => assertThreadOwner({ ownerId: owner.sessionId }, other)).toThrow(
      /belongs to a different session/i,
    );
  });

  it("adopts legacy rows that predate ownership", () => {
    // The first session that boots claims them in seed.ensureSeeded; until then
    // they stay reachable instead of disappearing from the workspace.
    expect(ownsThread({}, owner)).toBe(true);
  });
});
