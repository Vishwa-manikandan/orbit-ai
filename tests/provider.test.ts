import { describe, expect, it } from "vitest";
import {
  AgentError,
  backoffMs,
  providerErrorFromStatus,
  toAgentError,
  userMessageFor,
} from "@/convex/lib/errors";
import { describeProvider, resolvePlanner } from "@/convex/lib/llmProvider";

describe("provider resolution", () => {
  it("reports that nothing is configured instead of pretending", () => {
    const descriptor = describeProvider({});
    expect(descriptor.kind).toBe("unconfigured");
    expect(descriptor.model).toBeNull();
    expect(descriptor.host).toBeNull();
    expect(descriptor.reason).toMatch(/OPENAI_API_KEY/);
    expect(resolvePlanner({}).kind).toBe("unconfigured");
  });

  it("describes a configured provider without leaking the key", () => {
    const env = {
      OPENAI_API_KEY: "sk-super-secret-value",
      OPENAI_MODEL: "gpt-test",
      OPENAI_BASE_URL: "https://gateway.example/v1",
    };
    const descriptor = describeProvider(env);
    expect(descriptor).toMatchObject({
      kind: "llm",
      model: "gpt-test",
      host: "gateway.example",
      envVar: "OPENAI_API_KEY",
      reason: null,
    });
    expect(JSON.stringify(descriptor)).not.toContain("sk-super-secret-value");

    const resolved = resolvePlanner(env);
    expect(resolved.kind).toBe("llm");
    if (resolved.kind !== "llm") return;
    expect(resolved.config.apiKey).toBe("sk-super-secret-value");
    expect(resolved.config.baseUrl).toBe("https://gateway.example/v1");
  });

  it("rejects a base URL that is not a URL", () => {
    const resolved = resolvePlanner({
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: "not-a-url",
    });
    expect(resolved.kind).toBe("unconfigured");
    expect(resolved.descriptor.reason).toMatch(/not a valid URL/i);
  });

  it("recognizes the OpenLLM gateway variable", () => {
    const descriptor = describeProvider({
      OPENLLM_API_KEY: "gateway-key",
      OPENLLM_ENDPOINT: "https://openllm.example/v1",
    });
    expect(descriptor.kind).toBe("llm");
    expect(descriptor.envVar).toBe("OPENLLM_API_KEY");
    expect(descriptor.host).toBe("openllm.example");
  });
});

describe("structured errors", () => {
  it("classifies provider status codes by what the caller should do", () => {
    const limited = providerErrorFromStatus(429, "slow down");
    expect(limited.code).toBe("provider_rate_limited");
    expect(limited.retryable).toBe(true);

    const outage = providerErrorFromStatus(503, "unavailable");
    expect(outage.code).toBe("provider_unavailable");
    expect(outage.retryable).toBe(true);

    const rejected = providerErrorFromStatus(401, "bad key");
    expect(rejected.code).toBe("provider_rejected");
    expect(rejected.retryable).toBe(false);
    expect(rejected.status).toBe(401);
    expect(rejected.message).toContain("LLM request failed (401)");
  });

  it("separates an exhausted balance from a rate limit, because only one is worth retrying", () => {
    const quota = providerErrorFromStatus(
      429,
      '{"error":{"type":"insufficient_quota","code":"credit_balance_exhausted","message":"You have no credits remaining."}}',
    );
    expect(quota.code).toBe("provider_quota_exhausted");
    expect(quota.retryable).toBe(false);

    const message = userMessageFor(quota);
    expect(message).toMatch(/no credits/i);
    expect(message).not.toMatch(/wait a moment/i);
  });

  it("treats an aggregator's 402 as an empty balance, not a bad request", () => {
    const quota = providerErrorFromStatus(
      402,
      '{"error":{"message":"This request requires more credits, or fewer max_tokens.","code":402}}',
    );
    expect(quota.code).toBe("provider_quota_exhausted");
    expect(quota.retryable).toBe(false);
    expect(quota.status).toBe(402);
  });

  it("normalizes timeouts, network failures and unknown errors", () => {
    const timeout = toAgentError(new DOMException("timed out", "TimeoutError"));
    expect(timeout).toMatchObject({ code: "provider_timeout", retryable: true });

    const network = toAgentError(new TypeError("fetch failed"));
    expect(network).toMatchObject({ code: "provider_unavailable", retryable: true });

    const unknown = toAgentError("something odd", "tool_failed");
    expect(unknown).toMatchObject({ code: "tool_failed", retryable: false });
    expect(unknown.message).toBe("something odd");

    const passthrough = new AgentError({ code: "plan_invalid", message: "bad args" });
    expect(toAgentError(passthrough)).toBe(passthrough);
  });

  it("backs off exponentially with a cap", () => {
    const delays = [1, 2, 3, 4, 8, 20].map((attempt) => backoffMs(attempt, { base: 100 }));
    expect(delays[0]).toBeLessThan(delays[1]);
    expect(delays[1]).toBeLessThan(delays[2]);
    expect(delays[2]).toBeLessThan(delays[3]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(2_500);
  });

  it("tells the user how to fix a provider problem without echoing secrets", () => {
    const message = userMessageFor(
      new AgentError({
        code: "provider_rejected",
        message: "LLM request failed (401)",
        status: 401,
      }),
    );
    expect(message).toContain("OPENAI_API_KEY");
    expect(message).toContain("401");
    expect(message).not.toMatch(/sk-/);
  });
});
