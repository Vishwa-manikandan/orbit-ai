/**
 * A single error shape for everything that can go wrong between a user request
 * and a tool result. The orchestrator, the planner and the UI all speak it, so
 * a provider outage, a bad key, and a bad tool argument are distinguishable
 * instead of collapsing into "something went wrong".
 */
export type AgentErrorCode =
  | "provider_unconfigured"
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_quota_exhausted"
  | "provider_rejected"
  | "provider_unavailable"
  | "provider_bad_response"
  | "plan_invalid"
  | "plan_missing_arguments"
  | "tool_not_found"
  | "tool_denied"
  | "tool_failed"
  | "internal";

export type AgentErrorInit = {
  code: AgentErrorCode;
  message: string;
  retryable?: boolean;
  status?: number;
  cause?: unknown;
};

const RETRYABLE_BY_DEFAULT: AgentErrorCode[] = [
  "provider_timeout",
  "provider_rate_limited",
  "provider_unavailable",
];

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(init: AgentErrorInit) {
    super(init.message);
    this.name = "AgentError";
    this.code = init.code;
    this.retryable = init.retryable ?? RETRYABLE_BY_DEFAULT.includes(init.code);
    this.status = init.status;
    if (init.cause !== undefined) this.cause = init.cause;
  }
}

/**
 * Strips credential-shaped tokens from text before it can be stored on a run
 * or shown to the user. Provider error bodies sometimes echo the key that was
 * presented ("Incorrect API key provided: sk-…"), and that must never reach
 * the browser.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer ***");
}

/**
 * Bodies that mean "this account cannot pay for the request" rather than
 * "you are sending too fast". Both arrive as HTTP 429, but retrying is only
 * useful for one of them.
 */
const QUOTA_PATTERN =
  /insufficient_quota|credit_balance_exhausted|no credits remaining|exceeded your current quota|requires more credits/i;

/** HTTP status → provider error code. 4xx (auth/bad request) is not retryable. */
export function providerErrorFromStatus(status: number, detail: string): AgentError {
  const message = `LLM request failed (${status}): ${redactSecrets(detail.slice(0, 300))}`;
  // Aggregators (OpenRouter) answer 402 "Payment Required" for a balance that
  // cannot cover the request; that is the same wall as an exhausted quota and
  // retrying it only burns time.
  if (status === 402) {
    return new AgentError({
      code: "provider_quota_exhausted",
      message,
      status,
      retryable: false,
    });
  }
  if (status === 429) {
    if (QUOTA_PATTERN.test(detail)) {
      return new AgentError({
        code: "provider_quota_exhausted",
        message,
        status,
        retryable: false,
      });
    }
    return new AgentError({ code: "provider_rate_limited", message, status, retryable: true });
  }
  if (status >= 500) {
    return new AgentError({ code: "provider_unavailable", message, status, retryable: true });
  }
  return new AgentError({ code: "provider_rejected", message, status, retryable: false });
}

function isTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Normalize anything thrown by a provider, a tool, or Convex into an
 * AgentError. Unknown errors keep their message and are treated as internal.
 */
export function toAgentError(error: unknown, fallback: AgentErrorCode = "internal"): AgentError {
  if (error instanceof AgentError) return error;

  if (isTimeout(error)) {
    return new AgentError({
      code: "provider_timeout",
      message: "The model provider timed out.",
      retryable: true,
      cause: error,
    });
  }

  if (error instanceof TypeError && /fetch|network|ECONN|ENOTFOUND/i.test(error.message)) {
    return new AgentError({
      code: "provider_unavailable",
      message: `Could not reach the model provider: ${error.message}`,
      retryable: true,
      cause: error,
    });
  }

  const message = error instanceof Error ? error.message : String(error ?? "Unexpected error.");
  return new AgentError({ code: fallback, message, cause: error });
}

/** Exponential backoff with bounded jitter, in milliseconds. */
export function backoffMs(attempt: number, options: { base?: number; cap?: number } = {}): number {
  const base = options.base ?? 150;
  const cap = options.cap ?? 2_000;
  const exponential = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  const jitter = exponential * 0.25 * ((attempt * 37) % 100) / 100;
  return Math.round(exponential + jitter);
}

/**
 * Delay inside a Convex action. Convex's default V8 runtime does not always
 * expose timers, so this degrades to an immediate retry instead of failing.
 */
export async function delay(ms: number): Promise<void> {
  if (typeof setTimeout !== "function") return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Actionable copy for the user. Never includes credentials — only env var
 * names and provider status codes.
 */
export function userMessageFor(error: AgentError): string {
  switch (error.code) {
    case "provider_unconfigured":
      return "No language model is configured, so I can only run the built-in patterns. Set `OPENAI_API_KEY` on the Convex deployment to enable natural-language planning.";
    case "provider_rejected":
      return `The model provider rejected the request${
        error.status ? ` (HTTP ${error.status})` : ""
      }. Check \`OPENAI_API_KEY\`, \`OPENAI_MODEL\`, and \`OPENAI_BASE_URL\` on the Convex deployment.`;
    case "provider_timeout":
      return "The model provider didn't answer in time. I stopped the run rather than guess — try again.";
    case "provider_rate_limited":
      return "The model provider is rate limiting requests. Wait a moment and try again.";
    case "provider_quota_exhausted":
      return "The model key is accepted, but the provider account has no credits left, so no request can be answered. Add credits to the provider account (or switch `OPENAI_API_KEY` to a funded key) and try again — retrying now will fail the same way.";
    case "provider_unavailable":
      return "The model provider is unreachable right now. Check the base URL or your connection, then try again.";
    case "provider_bad_response":
      return "The model returned a response I couldn't use. The run stopped before executing anything.";
    case "plan_invalid":
      return `I planned a step I couldn't safely execute, so I stopped. ${error.message}`;
    case "plan_missing_arguments":
      return `I need more information before I can do that: ${error.message}`;
    case "tool_not_found":
      return `I tried to use a tool that doesn't exist, so I stopped. ${error.message}`;
    case "tool_denied":
      return `That action isn't permitted on this deployment, so I didn't run it. ${error.message}`;
    case "tool_failed":
      return `A tool failed and I stopped the run: ${error.message}`;
    default:
      return "I ran into an unexpected problem and stopped. The trace has the details — try again or rephrase the request.";
  }
}
