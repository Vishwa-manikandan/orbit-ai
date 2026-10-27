/**
 * A scripted OpenAI-compatible provider for manual verification of the model
 * path without a real key.
 *
 *   node tests/fixtures/mock-llm-server.mjs          # listens on :4599
 *   npx convex env set OPENAI_API_KEY mock-key
 *   npx convex env set OPENAI_BASE_URL http://127.0.0.1:4599/v1
 *   npx convex env set OPENAI_MODEL mock-orbit
 *
 * It answers based on what the runtime actually sent, so a passing check proves
 * that tool results come back to the planner: the second turn can only name the
 * sender or the thread id by reading the first turn's result.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_LLM_PORT ?? 4599);
const MARKER = "Tool results in this request:\n";

function extractRequest(content) {
  const match = content.match(/User request: ([\s\S]*?)\n\nContext:/);
  return match ? match[1].trim() : "";
}

function extractObservations(content) {
  const index = content.indexOf(MARKER);
  if (index === -1) return [];
  let rest = content.slice(index + MARKER.length);
  for (const stop of ["\n\nContinue:", "\n\nUse these results"]) {
    const at = rest.indexOf(stop);
    if (at !== -1) rest = rest.slice(0, at);
  }
  try {
    const parsed = JSON.parse(rest.trim());
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toolCall(name, args) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `call_${Date.now()}`,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  };
}

function reply(text) {
  return { choices: [{ message: { role: "assistant", content: text } }] };
}

function script(prompt, observations, content) {
  if (/^send it/i.test(prompt)) {
    if (observations.length === 0) {
      // The draft id comes from the context digest the runtime sends.
      const draftId = (content.match(/"draftId": "([^"]+)"/) || [])[1];
      if (draftId) return toolCall("email.sendDraft", { draftId });
      return reply("There is no unsent draft in the outbox.");
    }
    return reply(String(observations[0]?.summary ?? "Sent.").replace(/\*\*/g, ""));
  }

  if (/follow[- ]?up/i.test(prompt)) {
    // Deliberately omits the required `title`, so the runtime has to ask for it
    // instead of running the tool with a missing argument.
    if (observations.length === 0) return toolCall("tasks.createFollowUp", { source: "Marcus Webb" });
    return reply("Created it.");
  }

  if (/pricing/i.test(prompt)) {
    if (observations.length === 0) {
      return toolCall("email.searchThreads", { query: "pricing", limit: 5 });
    }
    const sender = observations[0]?.data?.threads?.[0]?.from ?? "a teammate";
    return reply(
      `The pricing-page thread is with ${sender}. They tightened the headline and want a last read on the copy before it goes to engineering.`,
    );
  }

  if (/q3 launch/i.test(prompt)) {
    if (observations.length === 0) {
      return toolCall("email.searchThreads", { query: "Q3 launch", limit: 3 });
    }
    if (observations.length === 1) {
      const threadId = observations[0]?.data?.threads?.[0]?.id;
      if (threadId) return toolCall("email.summarizeThread", { threadId });
      return reply("I couldn't find a matching thread.");
    }
    const summary = String(observations[1]?.summary ?? "").replace(/\*\*/g, "");
    return reply(
      `${summary}\n\nSarah needs the launch deck by Thursday, and the onboarding flow is the open risk.`,
    );
  }

  if (/which thread|draft a reply/i.test(prompt)) {
    return {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: `call_${Date.now()}`,
                type: "function",
                function: {
                  name: "askUser",
                  arguments: JSON.stringify({
                    question: "Which thread should I reply to?",
                    options: [
                      "Reply to Sarah Chen about the Q3 launch timeline",
                      "Reply to Marcus Webb about the pricing page copy",
                    ],
                  }),
                },
              },
            ],
          },
        },
      ],
    };
  }

  return reply(
    `I can triage your inbox, prepare meeting briefs, and draft replies. You asked: “${prompt}”.`,
  );
}

/**
 * Streams a scripted answer the way a real OpenAI-compatible provider does when
 * `stream: true`: content in deltas, and long tool arguments split across
 * fragments so the runtime has to reassemble them.
 */
function sendStream(response, answer) {
  const message = answer.choices?.[0]?.message ?? {};
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const write = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);

  if (message.tool_calls?.length) {
    for (const [index, call] of message.tool_calls.entries()) {
      const args = String(call.function?.arguments ?? "");
      const split = Math.ceil(args.length / 2);
      write({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index,
                  id: call.id,
                  function: { name: call.function?.name, arguments: args.slice(0, split) },
                },
              ],
            },
          },
        ],
      });
      write({
        choices: [{ delta: { tool_calls: [{ index, function: { arguments: args.slice(split) } }] } }],
      });
    }
  } else if (typeof message.content === "string") {
    for (const chunk of message.content.match(/[\s\S]{1,24}/g) ?? []) {
      write({ choices: [{ delta: { content: chunk } }] });
    }
  }

  response.write("data: [DONE]\n\n");
  response.end();
}

const server = createServer((request, response) => {
  if (!request.url?.endsWith("/chat/completions") || request.method !== "POST") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
    return;
  }

  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "invalid json" }));
      return;
    }

    const last = payload.messages?.[payload.messages.length - 1]?.content ?? "";
    const prompt = extractRequest(String(last));
    const observations = extractObservations(String(last));
    const answer = script(prompt, observations, String(last));

    const called = answer.choices?.[0]?.message?.tool_calls?.[0]?.function?.name ?? "reply";
    console.log(
      `[mock-llm] prompt=${JSON.stringify(prompt)} observations=${observations.length} -> ${called}`,
    );

    if (payload.stream) {
      sendStream(response, answer);
      return;
    }

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(answer));
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock OpenAI-compatible provider listening on http://127.0.0.1:${PORT}/v1`);
});
