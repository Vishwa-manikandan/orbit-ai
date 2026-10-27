import { describe, expect, it } from "vitest";
import { isEventStream, readCompletionStream } from "@/convex/lib/stream";
import { AgentError } from "@/convex/lib/errors";

function content(value: string) {
  return { choices: [{ delta: { content: value } }] };
}

function toolFragment(
  index: number,
  fragment: { id?: string; name?: string; arguments?: string },
) {
  // OpenAI-compatible providers nest name/arguments under `function`, and send
  // long names and arguments in fragments that must be concatenated.
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index,
              ...(fragment.id ? { id: fragment.id } : {}),
              function: {
                ...(fragment.name !== undefined ? { name: fragment.name } : {}),
                ...(fragment.arguments !== undefined ? { arguments: fragment.arguments } : {}),
              },
            },
          ],
        },
      },
    ],
  };
}

function sseResponse(events: unknown[], options: { done?: boolean } = {}): Response {
  const frames = events.map((event) => `data: ${JSON.stringify(event)}\n\n`);
  if (options.done !== false) frames.push("data: [DONE]\n\n");
  return new Response(frames.join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("event-stream completion reader", () => {
  it("assembles content deltas and reports the text so far", async () => {
    const seen: string[] = [];
    const result = await readCompletionStream(
      sseResponse([content("Your inbox "), content("has "), content("2 threads.")]),
      { onText: (text) => void seen.push(text) },
    );

    expect(result.content).toBe("Your inbox has 2 threads.");
    expect(result.cancelled).toBe(false);
    expect(seen.at(-1)).toBe("Your inbox has 2 threads.");
  });

  it("assembles tool calls that arrive in fragments", async () => {
    const result = await readCompletionStream(
      sseResponse([
        toolFragment(0, { id: "call_1", name: "email.search", arguments: "" }),
        toolFragment(0, { name: "Threads", arguments: '{"needs' }),
        toolFragment(0, { arguments: 'Attention":true,"limit":3}' }),
      ]),
    );

    expect(result.toolCalls).toEqual([
      {
        index: 0,
        id: "call_1",
        name: "email.searchThreads",
        arguments: '{"needsAttention":true,"limit":3}',
      },
    ]);
  });

  it("keeps interleaved text and tool calls apart", async () => {
    const result = await readCompletionStream(
      sseResponse([
        content("Checking your calendar."),
        toolFragment(0, { id: "call_9", name: "calendar.findConflicts", arguments: '{"days":2}' }),
      ]),
    );

    expect(result.content).toBe("Checking your calendar.");
    expect(result.toolCalls[0].name).toBe("calendar.findConflicts");
  });

  it("ignores keep-alive and malformed frames", async () => {
    const response = new Response(
      [
        ": ping\n\n",
        "data: not-json\n\n",
        `data: ${JSON.stringify(content("Still here."))}\n\n`,
        "data: [DONE]\n\n",
      ].join(""),
      { headers: { "Content-Type": "text/event-stream" } },
    );

    const result = await readCompletionStream(response);
    expect(result.content).toBe("Still here.");
  });

  it("stops reading when the run is cancelled", async () => {
    let checks = 0;
    const result = await readCompletionStream(
      sseResponse([content("One. "), content("Two. "), content("Three.")]),
      {
        stopPollMs: 0,
        shouldStop: () => {
          checks += 1;
          return checks >= 2;
        },
      },
    );

    expect(result.cancelled).toBe(true);
    expect(result.content).not.toBe("One. Two. Three.");
    expect(checks).toBeGreaterThanOrEqual(2);
  });

  it("fails clearly when the provider returns no body", async () => {
    await expect(readCompletionStream(new Response(null))).rejects.toBeInstanceOf(AgentError);
  });

  it("detects the event-stream content type", () => {
    expect(
      isEventStream(
        new Response("", { headers: { "Content-Type": "text/event-stream; charset=utf-8" } }),
      ),
    ).toBe(true);
    expect(
      isEventStream(new Response("", { headers: { "Content-Type": "application/json" } })),
    ).toBe(false);
  });
});
