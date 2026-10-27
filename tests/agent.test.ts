import { describe, expect, it } from "vitest";
import { llmConfigFromEnv } from "@/convex/lib/llmPlanner";
import { composeReply, plannerFallbackMessage, rulesPlanner } from "@/convex/lib/planner";
import { getTool, toolCatalog, toolsForLLM, validateStep } from "@/convex/lib/tools";
import type { PlannerContext, ToolContext } from "@/convex/lib/types";
import { createMemoryPort, makeState, NOW } from "./helpers/memory-port";

function plannerContext(
  port: ReturnType<typeof createMemoryPort>,
  prompt: string,
): PlannerContext {
  return {
    now: NOW,
    prompt,
    recentMessages: [],
    mail: port.state.mail,
    drafts: port.state.drafts.filter((draft) => draft.status === "draft"),
    events: port.state.events,
    tasks: port.state.tasks,
  };
}

describe("rules planner", () => {
  it("plans a triage with summaries for messages needing attention", () => {
    const port = createMemoryPort();
    const plan = rulesPlanner(plannerContext(port, "What needs my attention?"));
    expect(plan.provider).toBe("rules");
    expect(plan.steps[0]).toMatchObject({ tool: "email.searchThreads" });
    expect(plan.steps.filter((step) => step.tool === "email.summarizeThread")).toHaveLength(2);
  });

  it("routes a send request to the approval-gated tool", () => {
    const port = createMemoryPort();
    const plan = rulesPlanner(plannerContext(port, "Send it"));
    expect(plan.steps).toEqual([
      expect.objectContaining({ tool: "email.sendDraft", args: { draftId: "draft_sarah" } }),
    ]);
  });

  it("explains that there is nothing to send when no draft exists", () => {
    const port = createMemoryPort();
    port.state.drafts = [];
    const plan = rulesPlanner(plannerContext(port, "Send it"));
    expect(plan.steps).toHaveLength(0);
    expect(plan.note).toMatch(/no unsent draft/i);
  });

  it("prepares the next meeting and checks conflicts", () => {
    const port = createMemoryPort();
    const prep = rulesPlanner(plannerContext(port, "Prepare me for my next meeting"));
    expect(prep.steps[0]).toMatchObject({
      tool: "calendar.prepBrief",
      args: { eventId: "event_design" },
    });

    const conflicts = rulesPlanner(plannerContext(port, "Do I have any conflicts tomorrow?"));
    expect(conflicts.steps[0]).toMatchObject({
      tool: "calendar.findConflicts",
      args: { days: 2 },
    });
  });

  it("grounds a draft in the matching thread and captures instructions", () => {
    const port = createMemoryPort();
    const plan = rulesPlanner(
      plannerContext(port, "Draft a reply to Sarah saying I'll share the deck tomorrow"),
    );
    expect(plan.steps[0]).toMatchObject({
      tool: "email.draftReply",
      args: {
        threadId: "mail_sarah",
        instructions: "I'll share the deck tomorrow",
      },
    });
  });

  it("creates a follow-up with a due date and strips the date from the title", () => {
    const port = createMemoryPort();
    const plan = rulesPlanner(
      plannerContext(port, "Add a follow-up with Marcus about the pricing page tomorrow"),
    );
    expect(plan.steps[0]).toMatchObject({
      tool: "tasks.createFollowUp",
      args: { title: "Marcus about the pricing page", dueAt: NOW + 24 * 60 * 60 * 1000 },
    });
  });

  it("routes \"summarize\" to the summarize tool", () => {
    // Regression: the previous regex required a word boundary after "summar",
    // so "summarize" fell through to a plain mailbox search.
    const port = createMemoryPort();
    const plan = rulesPlanner(plannerContext(port, "Summarize the thread from Sarah"));
    expect(plan.steps[0]).toMatchObject({
      tool: "email.summarizeThread",
      args: { threadId: "mail_sarah" },
    });
  });

  it("does not invent a mailbox query when no person is named", () => {
    // Regression: the old last resort searched for the first thread's sender.
    const port = createMemoryPort();
    const plan = rulesPlanner(plannerContext(port, "What's in my email?"));
    expect(plan.steps[0]).toMatchObject({
      tool: "email.searchThreads",
      args: { limit: 5 },
    });
    expect(plan.steps[0].args).not.toHaveProperty("query");
  });

  it("resolves a follow-up against the previous tool result", () => {
    const port = createMemoryPort();
    const priorObservations: PlannerContext["priorObservations"] = [
      {
        stepIndex: 0,
        tool: "email.searchThreads",
        args: { needsAttention: true, limit: 5 },
        ok: true,
        summary: "2 messages need attention",
        data: { threads: port.state.mail.filter((thread) => thread.needsAttention) },
      },
    ];

    const plan = rulesPlanner({
      ...plannerContext(port, "Summarize the second one"),
      priorObservations,
    });

    expect(plan.steps[0]).toMatchObject({
      tool: "email.summarizeThread",
      args: { threadId: "mail_marcus" },
    });
  });

  it("asks which thread to reply to instead of guessing", () => {
    const port = createMemoryPort();
    const plan = rulesPlanner(plannerContext(port, "Draft a reply"));

    expect(plan.steps).toHaveLength(0);
    expect(plan.clarification?.question).toMatch(/which thread/i);
    expect(plan.clarification?.options).toHaveLength(2);
    expect(plan.suggestions).toEqual(plan.clarification?.options);
  });

  it("does not treat \"send a follow-up\" as sending email", () => {
    const port = createMemoryPort();
    const plan = rulesPlanner(
      plannerContext(port, "Send a follow-up to Marcus about pricing"),
    );
    expect(plan.steps[0]).toMatchObject({ tool: "tasks.createFollowUp" });
  });

  it("reports an approved send instead of planning it again", () => {
    const port = createMemoryPort();
    const plan = rulesPlanner({
      ...plannerContext(port, "Send it"),
      priorObservations: [
        {
          stepIndex: 0,
          tool: "email.sendDraft",
          args: { draftId: "draft_sarah" },
          ok: true,
          summary: "Sent **Re: Q3 launch timeline** to sarah@northwindlabs.com.",
        },
      ],
    });

    expect(plan.steps).toHaveLength(0);
    expect(plan.answer).toContain("sarah@northwindlabs.com");
  });

  it("falls back to capability guidance for unclear requests", () => {
    const port = createMemoryPort();
    const plan = rulesPlanner(plannerContext(port, "hello there"));
    expect(plan.steps).toHaveLength(0);
    expect(plan.note).toMatch(/inbox, calendar, and follow-ups/i);
    expect(plan.unsupported).toBe(true);

    // Without a model behind the patterns, say so instead of implying the
    // request was understood.
    const message = plannerFallbackMessage(plan, false);
    expect(message).toMatch(/No language model is configured/i);
    expect(message).toContain("OPENAI_API_KEY");
    expect(message).toMatch(/inbox, calendar, and follow-ups/i);

    // With a model configured, the guidance stands on its own.
    expect(plannerFallbackMessage(plan, true)).toBe(plan.note);
  });

  it("does not flag a request the built-in patterns can handle", () => {
    const port = createMemoryPort();
    const plan = rulesPlanner(plannerContext(port, "What needs my attention?"));
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.unsupported).toBeUndefined();
  });
});

describe("tool validation", () => {
  it("accepts valid arguments and rejects out-of-range values", () => {
    expect(
      validateStep({ tool: "email.searchThreads", args: { needsAttention: true }, rationale: "" }),
    ).toEqual({ ok: true, args: { needsAttention: true } });

    const invalid = validateStep({
      tool: "email.searchThreads",
      args: { limit: 0 },
      rationale: "",
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error).toMatch(/limit/i);
  });

  it("rejects unknown tools", () => {
    const result = validateStep({ tool: "email.deleteEverything", args: {}, rationale: "" });
    expect(result).toEqual({ ok: false, error: "Unknown tool “email.deleteEverything”." });
  });

  it("marks only outbound tools as approval-gated", () => {
    const gated = toolCatalog.filter((tool) => tool.requiresApproval);
    expect(gated.map((tool) => tool.name)).toEqual(["email.sendDraft"]);
  });

  it("generates JSON schemas for the LLM tool catalog", () => {
    const tools = toolsForLLM();
    expect(tools).toHaveLength(toolCatalog.length);
    expect(tools[0].type).toBe("function");
    expect(tools[0].function.parameters).toMatchObject({ type: "object" });
  });
});

describe("tool execution", () => {
  it("drafts a reply without executing an outbound action", async () => {
    const port = createMemoryPort();
    const tool = getTool("email.draftReply")!;
    const context: ToolContext = { port, now: NOW };

    const result = await tool.run(
      { threadId: "mail_sarah", instructions: "I'll share the deck tomorrow" },
      context,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain("Drafted a reply to **Sarah Chen**");
    expect(port.state.drafts).toHaveLength(2);
    const draft = port.state.drafts[1];
    expect(draft.subject).toBe("Re: Q3 launch timeline");
    expect(draft.body).toContain("I'll share the deck tomorrow.");
    expect(draft.status).toBe("draft");
  });

  it("requires approval and describes the exact message before sending", async () => {
    const port = createMemoryPort();
    const tool = getTool("email.sendDraft")!;
    const context: ToolContext = { port, now: NOW };

    expect(tool.requiresApproval).toBe(true);
    const copy = await tool.describeApproval!({ draftId: "draft_sarah" }, context);
    expect(copy.title).toBe("Send reply to Sarah Chen");
    expect(copy.detail).toContain("Re: Q3 launch timeline");
    expect(copy.detail).toContain("We're on track for Thursday.");

    const result = await tool.run({ draftId: "draft_sarah" }, context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary).toContain("sarah@northwindlabs.com");
    expect(port.state.drafts[0].status).toBe("sent");
  });

  it("prevents a duplicate send", async () => {
    const port = createMemoryPort();
    const tool = getTool("email.sendDraft")!;
    const context: ToolContext = { port, now: NOW };

    await tool.run({ draftId: "draft_sarah" }, context);
    const duplicate = await tool.run({ draftId: "draft_sarah" }, context);

    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error).toBe("Draft already sent.");
  });

  it("sends the thread's newest unsent draft when the planner passes a thread id", async () => {
    // Regression: the model was shown thread ids in the context digest and passed
    // one as draftId. Normalizing it as a draft id threw inside the send handler
    // and the approval card fell back to a generic argument dump.
    const port = createMemoryPort();
    const tool = getTool("email.sendDraft")!;
    const context: ToolContext = { port, now: NOW };

    const copy = await tool.describeApproval!({ draftId: "mail_sarah" }, context);
    expect(copy.title).toBe("Send reply to Sarah Chen");
    expect(copy.detail).toContain("Re: Q3 launch timeline");

    const result = await tool.run({ draftId: "mail_sarah" }, context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary).toContain("sarah@northwindlabs.com");
    expect(port.state.drafts[0].status).toBe("sent");
  });

  it("explains a draft id it cannot resolve instead of failing the run", async () => {
    const port = createMemoryPort();
    const tool = getTool("email.sendDraft")!;
    const context: ToolContext = { port, now: NOW };

    const copy = await tool.describeApproval!({ draftId: "nope" }, context);
    expect(copy.detail).toContain("No draft matches");

    const result = await tool.run({ draftId: "nope" }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.summary).toContain("nothing was sent");
      expect(result.error).not.toMatch(/at handler|\.ts:/);
    }
    expect(port.state.drafts.every((draft) => draft.status === "draft")).toBe(true);
  });

  it("keeps a thrown adapter message free of handler stack frames", async () => {
    const port = createMemoryPort();
    const tool = getTool("email.sendDraft")!;
    const context: ToolContext = {
      port: {
        ...port,
        sendDraft: async () => {
          throw new Error("Uncaught Error: Draft was already sent. at handler (../convex/workspace.ts:139:24)");
        },
      },
      now: NOW,
    };

    const result = await tool.run({ draftId: "draft_sarah" }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.summary).toContain("Draft was already sent.");
      expect(result.summary).not.toMatch(/workspace\.ts|at handler/);
    }
  });

  it("summarizes, searches, and builds a meeting brief from real context", async () => {
    const port = createMemoryPort();
    const context: ToolContext = { port, now: NOW };

    const search = await getTool("email.searchThreads")!.run(
      { needsAttention: true, limit: 5 },
      context,
    );
    expect(search.ok).toBe(true);
    if (search.ok) expect((search.data as { threads: unknown[] }).threads).toHaveLength(2);

    const summary = await getTool("email.summarizeThread")!.run(
      { threadId: "mail_sarah" },
      context,
    );
    expect(summary.ok).toBe(true);
    if (summary.ok) {
      expect(summary.summary).toContain("Q3 launch timeline");
      expect(summary.summary).toContain("needs a reply");
    }

    const brief = await getTool("calendar.prepBrief")!.run({ eventId: "event_design" }, context);
    expect(brief.ok).toBe(true);
    if (brief.ok) {
      expect(brief.summary).toContain("# Design review");
      expect(brief.summary).toContain("Sarah Chen");
      expect(brief.summary).toContain("From email");
    }
  });

  it("detects the seeded calendar overlap", async () => {
    const port = createMemoryPort();
    const result = await getTool("calendar.findConflicts")!.run({ days: 7 }, {
      port,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("1 conflict");
      expect(result.summary).toContain("Q3 launch planning");
      expect(result.summary).toContain("Deep work");
    }
  });

  it("creates follow-up tasks through the port", async () => {
    const port = createMemoryPort();
    const result = await getTool("tasks.createFollowUp")!.run(
      { title: "Send the pricing copy to Marcus", dueAt: NOW + 86_400_000 },
      { port, now: NOW },
    );
    expect(result.ok).toBe(true);
    expect(port.state.tasks.at(-1)?.title).toBe("Send the pricing copy to Marcus");
  });
});

describe("reply composition", () => {
  it("joins successful tool summaries and handles total failure", () => {
    expect(
      composeReply([
        { ok: true, summary: "Found 2 messages." },
        { ok: true, summary: "Sent the reply." },
      ]),
    ).toBe("Found 2 messages.\n\nSent the reply.");

    expect(composeReply([{ ok: false, summary: "Search failed." }])).toBe("Search failed.");
    expect(composeReply([])).toMatch(/didn't run any tools/i);
  });
});

describe("LLM configuration", () => {
  it("stays on the rules planner without a key", () => {
    expect(llmConfigFromEnv({})).toBeNull();
  });

  it("supports an OpenAI-compatible gateway", () => {
    expect(
      llmConfigFromEnv({
        OPENLLM_API_KEY: "test-key",
        OPENLLM_ENDPOINT: "https://gateway.example/v1/",
        OPENAI_MODEL: "small-model",
      }),
    ).toEqual({
      apiKey: "test-key",
      baseUrl: "https://gateway.example/v1",
      model: "small-model",
      maxTokens: 1200,
    });
  });

  it("defaults to a currently supported Chat Completions model", () => {
    // gpt-4o-mini is deprecated (API shutdown 2027-01-14); the default must be a
    // model OpenAI documents for function calling on Chat Completions.
    expect(llmConfigFromEnv({ OPENAI_API_KEY: "sk-test" })).toEqual({
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.6-terra",
      maxTokens: 1200,
      reasoningEffort: "none",
    });
  });

  it("lets a deployment override the reasoning effort for its model", () => {    expect(
      llmConfigFromEnv({ OPENAI_API_KEY: "sk-test", OPENAI_REASONING_EFFORT: "low" }),
    ).toMatchObject({ reasoningEffort: "low" });

    // A non-reasoning model keeps the deterministic temperature-0 request.
    expect(
      llmConfigFromEnv({ OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "legacy-chat" }),
    ).not.toHaveProperty("reasoningEffort");
  });
});
