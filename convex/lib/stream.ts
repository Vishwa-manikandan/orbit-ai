import { AgentError } from "./errors";

export type StreamedToolCall = {
  index: number;
  id: string;
  name: string;
  arguments: string;
};

export type StreamResult = {
  /** Full assistant text assembled from deltas. */
  content: string;
  toolCalls: StreamedToolCall[];
  /** True when the caller asked to stop and the stream was cut short. */
  cancelled: boolean;
};

export type StreamOptions = {
  /** Called with the whole text so far, not just the new delta. */
  onText?: (accumulated: string) => void | Promise<void>;
  /** Checked while events arrive so a cancelled run stops spending tokens. */
  shouldStop?: () => boolean | Promise<boolean>;
  /** Minimum gap between shouldStop checks, in milliseconds. */
  stopPollMs?: number;
};

type CompletionDelta = {
  content?: string | null;
  tool_calls?: {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[];
};

const DONE = "[DONE]";

/**
 * Incremental reader for an OpenAI-compatible `text/event-stream` completion.
 * Handles content deltas and tool-call fragments, which arrive interleaved and
 * piecewise, and polls a cancellation predicate while events flow.
 */
export async function readCompletionStream(
  response: Response,
  options: StreamOptions = {},
): Promise<StreamResult> {
  const body = response.body;
  if (!body) {
    throw new AgentError({
      code: "provider_bad_response",
      message: "The provider returned an empty stream.",
    });
  }

  const stopPollMs = options.stopPollMs ?? 400;
  let lastStopCheck = 0;
  let content = "";
  let cancelled = false;
  const toolCalls = new Map<number, StreamedToolCall>();

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const maybeStop = async (): Promise<boolean> => {
    if (!options.shouldStop) return false;
    const now = Date.now();
    if (now - lastStopCheck < stopPollMs) return false;
    lastStopCheck = now;
    return Boolean(await options.shouldStop());
  };

  const apply = (payload: string): void => {
    if (payload === DONE) return;
    let event: { choices?: { delta?: CompletionDelta }[] };
    try {
      event = JSON.parse(payload);
    } catch {
      // Keep-alive comments and non-JSON frames are not fatal.
      return;
    }
    const delta = event.choices?.[0]?.delta;
    if (!delta) return;

    if (typeof delta.content === "string" && delta.content.length > 0) {
      content += delta.content;
    }

    for (const fragment of delta.tool_calls ?? []) {
      const index = fragment.index ?? 0;
      const current =
        toolCalls.get(index) ??
        ({ index, id: "", name: "", arguments: "" } satisfies StreamedToolCall);
      if (fragment.id) current.id = fragment.id;
      if (fragment.function?.name) current.name += fragment.function.name;
      if (fragment.function?.arguments) current.arguments += fragment.function.arguments;
      toolCalls.set(index, current);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line; OpenAI sends one `data:` line each.
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line.startsWith("data:")) {
          const payload = line.slice(5).trim();
          if (payload === DONE) {
            buffer = "";
            break;
          }
          apply(payload);
        }
        if (await maybeStop()) {
          cancelled = true;
          break;
        }
        newline = buffer.indexOf("\n");
      }

      if (cancelled) break;
      if (content.length > 0 && options.onText) {
        await options.onText(content);
      }
    }

    if (!cancelled) {
      // Flush a final frame that arrived without a trailing newline.
      for (const line of buffer.split("\n")) {
        if (line.startsWith("data:")) {
          const payload = line.slice(5).trim();
          if (payload !== DONE) apply(payload);
        }
      }
      if (content.length > 0 && options.onText) await options.onText(content);
    }
  } finally {
    try {
      if (cancelled) await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }

  return {
    content,
    toolCalls: [...toolCalls.values()].sort((a, b) => a.index - b.index),
    cancelled,
  };
}

/** True when a response is an event stream rather than a single JSON body. */
export function isEventStream(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes("text/event-stream");
}
