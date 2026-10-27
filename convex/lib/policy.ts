import type { ToolDefinition } from "./types";

/**
 * Tools are grouped by what they can do, not by which integration they touch.
 * Every tool is classified from its metadata, so a new tool cannot quietly
 * become auto-executable: adding one updates `permissionLevel` and therefore the
 * enforcement point in the orchestrator.
 */
export type PermissionLevel = "read" | "write" | "outbound";
export type PermissionDecision = "allow" | "approval" | "deny";

export type AgentPolicy = {
  /** Allow tools that create or mutate state (drafts, follow-ups). */
  allowWrites: boolean;
  /** Allow tools that leave the workspace (sending email). */
  allowOutbound: boolean;
};

export function flag(value: string | undefined, fallback = true): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return !/^(false|0|no|off)$/i.test(value.trim());
}

export function policyFromEnv(
  env: Record<string, string | undefined>,
): AgentPolicy {
  return {
    allowWrites: flag(env.AGENT_ALLOW_WRITES),
    allowOutbound: flag(env.AGENT_ALLOW_OUTBOUND),
  };
}

export function permissionLevel(tool: ToolDefinition): PermissionLevel {
  if (tool.requiresApproval) return "outbound";
  return tool.sideEffect ? "write" : "read";
}

export type ToolDecision = {
  level: PermissionLevel;
  decision: PermissionDecision;
  reason: string;
};

/**
 * The single place that decides whether a model-selected tool may run, must be
 * confirmed, or is refused. The model never sees or influences this.
 */
export function decideTool(
  tool: ToolDefinition,
  policy: AgentPolicy,
): ToolDecision {
  const level = permissionLevel(tool);

  if (level === "outbound") {
    return policy.allowOutbound
      ? {
          level,
          decision: "approval",
          reason: "Outbound action: requires explicit human approval.",
        }
      : {
          level,
          decision: "deny",
          reason:
            "Outbound actions are disabled on this deployment (AGENT_ALLOW_OUTBOUND=false).",
        };
  }

  if (level === "write") {
    return policy.allowWrites
      ? {
          level,
          decision: "allow",
          reason: "State-changing tool inside the workspace.",
        }
      : {
          level,
          decision: "deny",
          reason:
            "Write actions are disabled on this deployment (AGENT_ALLOW_WRITES=false).",
        };
  }

  return { level, decision: "allow", reason: "Read-only tool." };
}
