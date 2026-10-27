import { AgentError, backoffMs, delay, providerErrorFromStatus, toAgentError } from "./errors";
import { isEventStream, readCompletionStream } from "./stream";
import { toolsForLLM, validateStep } from "./tools";
import type {
  AgentDecision,
  PlanStep,
  PlannerContext,
  PlannerInput,
  PlannerResult,
  ToolObservation,
} from "./types";

export type LlmConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  /**
   * Upper bound on the tokens a single completion may generate. Sent on every
   * request: gateways such as OpenRouter reserve credit for the model's whole
   * context window when no limit is given and reject a funded-but-small balance
   * with a 402, even though a planner turn only ever emits a short tool call or
   * a few sentences.
   */
  maxTokens: number;
  /** Sent as `reasoning_effort` when the model family accepts it. */
  reasoningEffort?: string;
};

/** Enough for a tool call plus a short grounded answer; override with env. */
export const DEFAULT_MAX_TOKENS = 1_200;

function resolveMaxTokens(env: Record<string, string | undefined>): number {
  const raw = Number.parseInt(env.OPENAI_MAX_TOKENS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_TOKENS;
}

/**
 * Default planner model: a currently supported Chat Completions model with
 * function calling. (`gpt-4o-mini` is deprecated — API shutdown announced for
 * January 2027 — so new deployments must not start on it.) Deployments can
 * override it with `OPENAI_MODEL`.
 */
export const DEFAULT_MODEL = "gpt-5.6-terra";

/**
 * Reasoning effort for the request. OpenAI's tool-calling guidance for the
 * gpt-5/6 families on Chat Completions is to disable reasoning for
 * latency-sensitive function calling; `OPENAI_REASONING_EFFORT` overrides it
 * for any model (e.g. `low` on a gateway that expects it).
 */
function resolveReasoningEffort(
  env: Record<string, string | undefined>,
  model: string,
): string | undefined {
  const explicit = env.OPENAI_REASONING_EFFORT?.trim();
  if (explicit) return explicit;
  return /^gpt-[56]/.test(model) ? "none" : undefined;
}

export function llmConfigFromEnv(
  env: Record<string, string | undefined>,
): LlmConfig | null {
  const apiKey = env.OPENAI_API_KEY ?? env.OPENLLM_API_KEY;
  if (!apiKey) return null;
  const model = env.OPENAI_MODEL ?? DEFAULT_MODEL;
  const reasoningEffort = resolveReasoningEffort(env, model);
  return {
    apiKey,
    baseUrl: (env.OPENAI_BASE_URL ?? env.OPENLLM_ENDPOINT ?? "https://api.openai.com/v1").replace(
      /\/$/,
      "",
    ),
    model,
    maxTokens: resolveMaxTokens(env),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

/**
 * Bound tool output without flattening it: the model needs real ids and field
 * names, so trim structurally instead of stringifying the whole payload.
 */
function trimValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > 1_200 ? `${value.slice(0, 1_200)}…` : value;
  }
  if (typeof value !== "object") return value;
  if (depth >= 3) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 5).map((item) => trimValue(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 12)
      .map(([key, item]) => [key, trimValue(item, depth + 1)]),
  );
}

function observationDigest(observations: ToolObservation[]) {
  return observations.map((observation) => ({
    step: observation.stepIndex,
    tool: observation.tool,
    args: observation.args,
    ok: observation.ok,
    summary: observation.summary.slice(0, 800),
    error: observation.error,
    data: trimValue(observation.data),
  }));
}

function contextDigest(context: PlannerContext) {
  return {
    now: new Date(context.now).toISOString(),
    inbox: context.mail.slice(0, 8).map((t) => ({
      threadId: t.id,
      from: t.from,
      subject: t.subject,
      snippet: t.snippet,
      needsAttention: t.needsAttention,
      receivedAt: new Date(t.receivedAt).toISOString(),
    })),
    drafts: context.drafts.map((d) => ({
      draftId: d.id,
      threadId: d.threadId,
      subject: d.subject,
      status: d.status,
      body: d.body,
    })),
    events: context.events.slice(0, 8).map((e) => ({
      eventId: e.id,
      title: e.title,
      start: new Date(e.start).toISOString(),
      end: new Date(e.end).toISOString(),
      attendees: e.attendees.map((a) => a.name),
      location: e.location,
      description: e.description,
    })),
    followUps: context.tasks.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt })),
  };
}

const SYSTEM_PROMPT = `You are the reasoning and planning layer of Orbit, a personal productivity agent that works on email, calendar, and follow-ups.

You operate in a loop:
1. You choose tool calls (or answer directly).
2. The runtime executes them and returns the results as "Tool results in this request".
3. You are called again with those results. Continue until the request is satisfied, then answer.

Rules:
- Use only the provided tools and the exact ids from the context or from earlier tool results. Never invent ids, subjects, or people.
- Never claim an action happened. Tools produce the result; your answer must be grounded in the tool output.
- Sending email is approval-gated by the runtime. Call email.sendDraft only when the user clearly asks to send, and never twice.
- For email.sendDraft, the draftId must be the draft id returned by email.draftReply or a draftId listed under drafts in the context — never a threadId. If you draft and send in one request, draft first, read the returned draft id, then send in your next turn.
- If the request is ambiguous in a way that would change what you do (two possible threads, no clear recipient, an unclear date), call askUser with a short question and 2–4 concrete options instead of guessing.
- If no tool is needed (a greeting, a question about yourself, an unclear request you cannot act on), answer directly in one or two sentences.
- If the request needs something outside the catalog (deleting mail, inviting attendees, a connected third-party app), say that this workspace cannot do it and name what it can do instead. Never invent a tool, a message, an event, or a receipt.
- Keep the final answer concise, specific, and grounded: name the people, subjects, and times you actually saw.`;

type ChatCompletion = {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
  }[];
};

type CompletionOutcome = {
  content: string;
  toolCalls: { id: string; function: { name: string; arguments: string } }[];
  cancelled: boolean;
};

export type LlmCallOptions = {
  /** Receives the assistant text so far while the provider streams it. */
  onText?: (accumulated: string) => void | Promise<void>;
  /** Polled during streaming so a cancelled run stops spending tokens. */
  shouldStop?: () => boolean | Promise<boolean>;
};

function completionMessages(input: PlannerInput): { role: string; content: string }[] {
  const { context, observations } = input;
  const history = [...context.recentMessages];
  // The current message is already persisted, and it is repeated below with
  // the context digest; send it once.
  while (
    history.length > 0 &&
    history[history.length - 1].role === "user" &&
    history[history.length - 1].content.trim() === context.prompt.trim()
  ) {
    history.pop();
  }
  const conversation = history
    .slice(-8)
    .map((message) => ({ role: message.role, content: message.content }));

  const prior = input.context.priorObservations ?? [];
  const sections = [
    `User request: ${context.prompt}`,
    `Context:\n${JSON.stringify(contextDigest(context), null, 2)}`,
  ];
  if (prior.length > 0) {
    sections.push(
      `Earlier tool results in this conversation:\n${JSON.stringify(
        observationDigest(prior.slice(-4)),
        null,
        2,
      )}`,
    );
  }
  if (observations.length > 0) {
    sections.push(
      `Tool results in this request:\n${JSON.stringify(observationDigest(observations), null, 2)}`,
    );
    sections.push(
      input.turn > 1
        ? "Continue: either call the next tool you still need, ask the user, or answer now using these results."
        : "Use these results to decide the next step.",
    );
  }

  return [...conversation, { role: "user", content: sections.join("\n\n") }];
}

async function requestCompletion(
  config: LlmConfig,
  messages: { role: string; content: string }[],
  options: LlmCallOptions = {},
): Promise<CompletionOutcome> {
  const streaming = Boolean(options.onText || options.shouldStop);

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: streaming ? "text/event-stream" : "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens,
      // Reasoning-family requests carry an explicit effort; classic requests
      // keep the deterministic temperature-0 setting the tests rely on.
      ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : { temperature: 0 }),
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      tools: toolsForLLM({ withClarify: true }),
      tool_choice: "auto",
      ...(streaming ? { stream: true } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw providerErrorFromStatus(response.status, body.slice(0, 300));
  }

  // Providers that don't support streaming answer with plain JSON. Both shapes
  // produce the same outcome, so the caller never branches on transport.
  if (isEventStream(response)) {
    const streamed = await readCompletionStream(response, {
      onText: options.onText,
      shouldStop: options.shouldStop,
    });
    return {
      content: streamed.content,
      cancelled: streamed.cancelled,
      toolCalls: streamed.toolCalls
        .filter((call) => call.name.length > 0)
        .map((call) => ({
          id: call.id || `call_${call.index}`,
          function: { name: call.name, arguments: call.arguments },
        })),
    };
  }

  let payload: ChatCompletion;
  try {
    payload = (await response.json()) as ChatCompletion;
  } catch (error) {
    throw new AgentError({
      code: "provider_bad_response",
      message: "The model provider returned a body that was not JSON.",
      cause: error,
    });
  }

  const message = payload.choices?.[0]?.message;
  if (!message) throw new Error("LLM returned no choices.");
  return {
    content: message.content ?? "",
    toolCalls: message.tool_calls ?? [],
    cancelled: false,
  };
}

function parseClarification(raw: string): { question: string; options: string[] } | null {
  let args: unknown;
  try {
    args = JSON.parse(raw || "{}");
  } catch {
    return null;
  }
  if (!args || typeof args !== "object") return null;
  const record = args as { question?: unknown; options?: unknown };
  const question = typeof record.question === "string" ? record.question.trim() : "";
  if (!question) return null;
  const options = Array.isArray(record.options)
    ? record.options
        .filter((option): option is string => typeof option === "string")
        .map((option) => option.trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];
  return { question, options };
}

/**
 * One planning turn against an OpenAI-compatible chat-completions endpoint.
 * Tool results from earlier turns are included, so the model can chain calls
 * and ground its final answer instead of planning blind.
 */
export async function llmDecision(
  input: PlannerInput,
  config: LlmConfig,
  options: LlmCallOptions = {},
): Promise<AgentDecision> {
  const provider = `llm:${config.model}`;
  const completion = await requestCompletion(config, completionMessages(input), options);
  if (completion.cancelled) {
    // The caller stopped the run while tokens were arriving; the loop turns
    // this into a cancelled outcome and keeps whatever text was streamed.
    return { kind: "reply", provider, message: completion.content.trim() };
  }

  const calls = completion.toolCalls;

  // Asking is always the safest action, so it wins over any other call.
  for (const call of calls) {
    if (call.function.name === "askUser") {
      const clarification = parseClarification(call.function.arguments);
      if (clarification) {
        return {
          kind: "clarify",
          provider,
          question: clarification.question,
          options:
            clarification.options.length > 0
              ? clarification.options
              : ["Review my inbox", "Prepare my next meeting"],
        };
      }
    }
  }

  const steps: PlanStep[] = [];
  const rejected: { tool: string; error: string; missing?: string[] }[] = [];

  for (const call of calls) {
    if (call.function.name === "askUser") continue;
    let args: unknown = {};
    let rationale = "Selected by the language model from the tool catalog.";
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      // Unparseable arguments can still be a usable call when every field is
      // optional; validation below decides.
      args = {};
      rationale = "Model plan (arguments were not valid JSON).";
    }
    const step: PlanStep = { tool: call.function.name, args, rationale };
    const validation = validateStep(step);
    if (validation.ok) steps.push(step);
    else
      rejected.push({
        tool: call.function.name,
        error: validation.error,
        ...(validation.missing ? { missing: validation.missing } : {}),
      });
  }

  const content = completion.content.trim();
  if (steps.length === 0) {
    // A call that is only incomplete is not a failure: ask for the specifics and
    // let the next turn retry with the answer, instead of dropping the request
    // or failing a run the user could have completed in one reply.
    const missing = [...new Set(rejected.flatMap((item) => item.missing ?? []))];
    if (missing.length > 0) {
      return {
        kind: "clarify",
        provider,
        question:
          missing.length === 1
            ? `I can do that, but I need the ${missing[0]} first. What should it be?`
            : `I can do that, but I need ${missing.join(" and ")} first. What should they be?`,
        options: [],
      };
    }
    if (content) {
      return { kind: "reply", provider, message: content };
    }
    if (calls.length > 0) {
      // Never complete a run on an empty plan: the model asked for tools and
      // every one of them was rejected, which the user must see.
      throw new AgentError({
        code: "plan_invalid",
        message: `The model proposed tool calls, but none passed validation (unknown tool or invalid arguments). ${rejected
          .map((item) => item.error)
          .join(" ")}`.trim(),
      });
    }
    throw new AgentError({
      code: "provider_bad_response",
      message: "The model returned neither tool calls nor a message.",
    });
  }

  return { kind: "tools", provider, steps, note: content || undefined };
}

/**
 * Single-turn compatibility wrapper: plan once, no observation feedback.
 * The orchestrator uses llmDecision through the agent loop instead.
 */
export async function llmPlanner(
  context: PlannerContext,
  config: LlmConfig,
): Promise<PlannerResult> {
  const decision = await llmDecision({ context, observations: [], turn: 1 }, config);
  if (decision.kind === "tools") {
    return { steps: decision.steps, provider: decision.provider, note: decision.note };
  }
  if (decision.kind === "clarify") {
    return {
      steps: [],
      provider: decision.provider,
      note: decision.question,
      answer: decision.question,
      clarification: { question: decision.question, options: decision.options },
      suggestions: decision.options,
    };
  }
  return {
    steps: [],
    provider: decision.provider,
    note: decision.message,
    answer: decision.message,
  };
}

export type LlmRetryOptions = {
  /** Total attempts; only retryable failures consume a retry. Default 2. */
  maxAttempts?: number;
  /** Runs before a retry (e.g. to discard text streamed by the failed attempt). */
  beforeRetry?: (attempt: number) => Promise<void> | void;
  /** Called exactly once with the error that is about to be surfaced. */
  onFinalError?: (error: AgentError) => void;
};

/**
 * One bounded retry loop around llmDecision. Transient failures (timeout,
 * rate limit, 5xx, unreachable host) retry once with backoff; every other
 * failure surfaces immediately. The final error always propagates — a
 * configured provider never quietly swaps itself for pattern-matched answers,
 * so the run fails with a recoverable, user-readable error instead.
 */
export async function llmDecisionWithRetry(
  input: PlannerInput,
  config: LlmConfig,
  options: LlmCallOptions = {},
  retry: LlmRetryOptions = {},
): Promise<AgentDecision> {
  const maxAttempts = Math.max(1, retry.maxAttempts ?? 2);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await llmDecision(input, config, options);
    } catch (error) {
      const failure = toAgentError(error, "provider_unavailable");
      if (!failure.retryable || attempt >= maxAttempts) {
        retry.onFinalError?.(failure);
        throw failure;
      }
      await retry.beforeRetry?.(attempt);
      await delay(backoffMs(attempt));
    }
  }
}
