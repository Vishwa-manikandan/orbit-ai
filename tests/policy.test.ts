import { describe, expect, it } from "vitest";
import { AgentError, userMessageFor } from "@/convex/lib/errors";
import { assertThreadOwner, ownsThread, resolvePrincipal } from "@/convex/lib/authz";
import {
  decideTool,
  flag,
  permissionLevel,
  policyFromEnv,
  type AgentPolicy,
} from "@/convex/lib/policy";
import { getTool, validateStep } from "@/convex/lib/tools";
import type { ToolDefinition } from "@/convex/lib/types";

const allowAll: AgentPolicy = { allowWrites: true, allowOutbound: true };

/** The real registry entry: permissions must come from shipped metadata. */
function tool(name: string): ToolDefinition {
  const found = getTool(name);
  if (!found) throw new Error(`missing test tool ${name}`);
  return found;
}

describe("tool permissions", () => {
  it("classifies tools by what they can do", () => {
    expect(permissionLevel(tool("email.searchThreads"))).toBe("read");
    expect(permissionLevel(tool("email.draftReply"))).toBe("write");
    expect(permissionLevel(tool("email.sendDraft"))).toBe("outbound");
  });

  it("allows reads, allows writes in the workspace, requires approval to send", () => {
    expect(decideTool(tool("calendar.listEvents"), allowAll)).toMatchObject({
      level: "read",
      decision: "allow",
    });
    expect(decideTool(tool("tasks.createFollowUp"), allowAll)).toMatchObject({
      level: "write",
      decision: "allow",
    });
    expect(decideTool(tool("email.sendDraft"), allowAll)).toMatchObject({
      level: "outbound",
      decision: "approval",
    });
  });

  it("refuses outbound actions when the deployment disables them", () => {
    const decision = decideTool(tool("email.sendDraft"), {
      allowWrites: true,
      allowOutbound: false,
    });
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("AGENT_ALLOW_OUTBOUND");
  });

  it("refuses write actions when the deployment disables them", () => {
    const decision = decideTool(tool("email.draftReply"), {
      allowWrites: false,
      allowOutbound: true,
    });
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("AGENT_ALLOW_WRITES");
  });

  it("reads the switches from the environment, defaulting to allowed", () => {
    expect(policyFromEnv({})).toEqual({ allowWrites: true, allowOutbound: true });
    expect(
      policyFromEnv({ AGENT_ALLOW_WRITES: "false", AGENT_ALLOW_OUTBOUND: "0" }),
    ).toEqual({ allowWrites: false, allowOutbound: false });
    expect(flag("no")).toBe(false);
    expect(flag("yes")).toBe(true);
    expect(flag(undefined)).toBe(true);
  });

  it("never exposes an unregistered tool", () => {
    expect(getTool("eval")).toBeUndefined();
    expect(getTool("calendar.listEvents")).toBeDefined();
    expect(validateStep({ tool: "code.run", args: {}, rationale: "" })).toEqual({
      ok: false,
      error: "Unknown tool “code.run”.",
    });
  });

  it("explains a denied action instead of pretending it worked", () => {
    const message = userMessageFor(
      new AgentError({
        code: "tool_denied",
        message: "Outbound actions are disabled on this deployment.",
      }),
    );
    expect(message).toMatch(/isn't permitted/i);
    expect(message).toContain("Outbound actions are disabled");
  });
});

describe("conversation ownership", () => {
  const session = "a".repeat(32);
  const other = "b".repeat(32);

  it("requires a well-formed session id", () => {
    expect(resolvePrincipal(session)).toEqual({ sessionId: session });
    expect(() => resolvePrincipal(undefined)).toThrow(/session id/i);
    expect(() => resolvePrincipal("short")).toThrow(/session id/i);
    expect(() => resolvePrincipal("has spaces in it here")).toThrow(/session id/i);
  });

  it("lets a session read its own thread and refuses another's", () => {
    const principal = resolvePrincipal(session);
    expect(ownsThread({ ownerId: session }, principal)).toBe(true);
    expect(ownsThread({ ownerId: other }, principal)).toBe(false);
    expect(() => assertThreadOwner({ ownerId: other }, principal)).toThrow(
      "This conversation belongs to a different session.",
    );
  });

  it("keeps pre-ownership threads reachable until the seed adopts them", () => {
    const principal = resolvePrincipal(session);
    expect(ownsThread({}, principal)).toBe(true);
    expect(() => assertThreadOwner({}, principal)).not.toThrow();
  });
});

describe("missing arguments", () => {
  it("names the field the model left out", () => {
    const result = validateStep({ tool: "tasks.createFollowUp", args: {}, rationale: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toEqual(["title"]);
    expect(result.error).toMatch(/title/i);
  });

  it("does not report optional fields as missing", () => {
    const result = validateStep({ tool: "tasks.createFollowUp", args: { title: "Send deck" }, rationale: "" });
    expect(result.ok).toBe(true);
  });

  it("separates missing information from invalid information", () => {
    // Out-of-range is invalid but present, so it is not a missing-argument case.
    const result = validateStep({
      tool: "email.searchThreads",
      args: { limit: 0 },
      rationale: "",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toBeUndefined();
    expect(result.error).toMatch(/limit/i);
  });

  it("turns missing arguments into an actionable message", () => {
    const message = userMessageFor(
      new AgentError({
        code: "plan_missing_arguments",
        message: "Missing required argument for tasks.createFollowUp: title.",
      }),
    );
    expect(message).toMatch(/need more information/i);
    expect(message).toContain("title");
  });
});
