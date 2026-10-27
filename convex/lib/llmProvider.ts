import { llmConfigFromEnv, type LlmConfig } from "./llmPlanner";

/**
 * Safe description of the configured planner. Deliberately excludes anything
 * secret: only the model name, the provider host, and the env var name.
 */
export type ProviderDescriptor = {
  kind: "llm" | "unconfigured";
  model: string | null;
  host: string | null;
  envVar: string | null;
  reason: string | null;
};

export type PlannerProvider =
  | { kind: "llm"; config: LlmConfig; descriptor: ProviderDescriptor }
  | { kind: "unconfigured"; config: null; descriptor: ProviderDescriptor };

const CREDENTIAL_VARS = ["OPENAI_API_KEY", "OPENLLM_API_KEY"];

function configuredVar(env: Record<string, string | undefined>): string | null {
  return CREDENTIAL_VARS.find((name) => Boolean(env[name]?.trim())) ?? null;
}

/** Host only — never a path or query, which could carry a key. */
function safeHost(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).host || null;
  } catch {
    return null;
  }
}

export function describeProvider(
  env: Record<string, string | undefined>,
): ProviderDescriptor {
  const config = llmConfigFromEnv(env);
  if (!config) {
    return {
      kind: "unconfigured",
      model: null,
      host: null,
      envVar: "OPENAI_API_KEY",
      reason:
        "No OPENAI_API_KEY (or OPENLLM_API_KEY) is set on the Convex deployment, so requests are handled by the built-in patterns.",
    };
  }
  const host = safeHost(config.baseUrl);
  return {
    kind: "llm",
    model: config.model,
    host,
    envVar: configuredVar(env),
    reason: host ? null : "OPENAI_BASE_URL is not a valid URL.",
  };
}

export function resolvePlanner(env: Record<string, string | undefined>): PlannerProvider {
  const config = llmConfigFromEnv(env);
  const descriptor = describeProvider(env);
  if (!config || !descriptor.host) {
    return { kind: "unconfigured", config: null, descriptor };
  }
  return { kind: "llm", config, descriptor };
}
