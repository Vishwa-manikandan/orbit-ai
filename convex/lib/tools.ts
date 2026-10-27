import { z } from "zod";
import type {
  CalendarEvent,
  Draft,
  MailThread,
  PlanStep,
  ToolCategory,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from "./types";

type AnyTool = ToolDefinition & {
  schema: z.ZodType<unknown>;
  run: (args: any, ctx: ToolContext) => Promise<ToolResult>;
  describeApproval?: (args: any, ctx: ToolContext) => Promise<{ title: string; detail: string }>;
};

const searchSchema = z.object({
  query: z.string().max(200).optional().describe("Free-text search across sender, subject, and body."),
  needsAttention: z.boolean().optional().describe("Only return messages that need a reply."),
  limit: z.number().int().min(1).max(20).optional(),
});

const threadRefSchema = z.object({
  threadId: z.string().optional().describe("An id returned by email.searchThreads."),
  query: z.string().max(200).optional().describe("Fallback search text used to find the thread."),
});

const summarizeSchema = threadRefSchema;

const draftSchema = threadRefSchema.extend({
  instructions: z
    .string()
    .max(2000)
    .optional()
    .describe("What the reply should say, in the user's words."),
});

const sendSchema = z.object({
  draftId: z.string().min(1).describe("The draft id returned by email.draftReply."),
});

const calendarListSchema = z.object({
  days: z.number().int().min(1).max(14).optional(),
});

const prepSchema = z.object({
  eventId: z.string().optional().describe("Defaults to the next upcoming event."),
});

const conflictsSchema = z.object({
  days: z.number().int().min(1).max(14).optional(),
});

const followUpSchema = z.object({
  title: z.string().min(2).max(200),
  dueAt: z.number().optional().describe("Unix timestamp in milliseconds."),
  source: z.string().max(200).optional(),
});

const emptySchema = z.object({});

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

/**
 * Convex reports a thrown handler as "Uncaught Error: … at handler (../convex/…)".
 * Keep the sentence and drop the frames: the trace should never show internals.
 */
function cleanErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const sentence = raw.split(/\s+\bat\s+/)[0]?.trim() ?? "";
  return sentence.replace(/^uncaught error:\s*/i, "").trim() || fallback;
}

/** Resolve the draft a send targets; a lookup failure must not crash the run. */
async function loadDraft(draftId: string, ctx: ToolContext): Promise<Draft | null> {
  try {
    return await ctx.port.resolveDraft(draftId);
  } catch {
    return null;
  }
}

function relative(ts: number, now: number): string {
  const delta = Math.max(0, now - ts);
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function upcomingLabel(ts: number, now: number): string {
  const delta = ts - now;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `in ${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

export function formatEventTime(ts: number): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
}

function firstSentences(text: string, count = 2): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const parts = cleaned.split(/(?<=[.!?])\s+/);
  return parts.slice(0, count).join(" ");
}

async function resolveThread(
  args: { threadId?: string; query?: string },
  ctx: ToolContext,
): Promise<MailThread | null> {
  if (args.threadId) {
    const byId = await ctx.port.getMailThread(args.threadId);
    if (byId) return byId;
  }
  const matches = await ctx.port.searchMail({
    query: args.query,
    limit: 1,
  });
  return matches[0] ?? null;
}

function overlaps(a: CalendarEvent, b: CalendarEvent): boolean {
  return a.start < b.end && b.start < a.end;
}

const definitions: AnyTool[] = [
  {
    name: "email.searchThreads",
    label: "Search email",
    category: "email",
    description:
      "Search the connected mailbox by sender, subject, or body. Use needsAttention to find messages waiting on the user.",
    requiresApproval: false,
    sideEffect: false,
    schema: searchSchema,
    run: async (args, ctx) => {
      const threads = await ctx.port.searchMail({
        query: args.query,
        needsAttention: args.needsAttention,
        limit: args.limit ?? 5,
      });
      if (threads.length === 0) {
        return {
          ok: true,
          summary: args.query
            ? `No messages matched “${args.query}”.`
            : "Nothing in the inbox needs attention right now.",
          data: { threads: [] },
        };
      }
      const mode = args.needsAttention ? "need attention" : "found";
      const lines = threads.map(
        (t) =>
          `- **${t.from}** — ${t.subject} · ${relative(t.receivedAt, ctx.now)}${
            t.unread ? " · unread" : ""
          }`,
      );
      return {
        ok: true,
        summary: `${threads.length} message${threads.length === 1 ? "" : "s"} ${mode}${
          args.query ? ` for “${args.query}”` : ""
        }:\n\n${lines.join("\n")}`,
        data: { threads },
      };
    },
  },
  {
    name: "email.summarizeThread",
    label: "Summarize thread",
    category: "email",
    description:
      "Read one email thread and return the key points, open questions, and the latest message. Requires a thread id or a search query.",
    requiresApproval: false,
    sideEffect: false,
    schema: summarizeSchema,
    run: async (args, ctx) => {
      const thread = await resolveThread(args, ctx);
      if (!thread) {
        return {
          ok: false,
          error: "No matching thread.",
          summary: args.query
            ? `I couldn't find a message matching “${args.query}”.`
            : "I couldn't find that thread.",
        };
      }
      const latest = thread.messages[thread.messages.length - 1];
      const points = firstSentences(latest?.body ?? thread.snippet, 2);
      const flags = [
        thread.needsAttention ? "needs a reply" : null,
        thread.unread ? "unread" : null,
        ...thread.labels,
      ].filter(Boolean);
      return {
        ok: true,
        summary: `**${thread.subject}** — from ${thread.from} (${relative(
          thread.receivedAt,
          ctx.now,
        )})\n${points}${flags.length ? `\n_${flags.join(" · ")}_` : ""}`,
        data: { thread, keyPoints: points },
      };
    },
  },
  {
    name: "email.draftReply",
    label: "Draft reply",
    category: "email",
    description:
      "Create a reply draft for a thread. This is safe: the draft is never sent without explicit approval.",
    requiresApproval: false,
    sideEffect: true,
    schema: draftSchema,
    run: async (args, ctx) => {
      const thread = await resolveThread(args, ctx);
      if (!thread) {
        return {
          ok: false,
          error: "No matching thread.",
          summary: args.query
            ? `I couldn't find a thread matching “${args.query}”.`
            : "I couldn't find that thread.",
        };
      }
      const intent = args.instructions?.trim();
      const paragraph = intent
        ? intent.charAt(0).toUpperCase() + intent.slice(1).replace(/[.!?]?$/, ".")
        : `Thanks for the note on “${thread.subject}”. I've read through it and will follow up with a concrete next step shortly.`;
      const subject = thread.subject.toLowerCase().startsWith("re:")
        ? thread.subject
        : `Re: ${thread.subject}`;
      const body = `Hi ${firstName(thread.from)},\n\n${paragraph}\n\nBest,\nAlex`;
      const draft = await ctx.port.createDraft({
        threadId: thread.id,
        subject,
        body,
        runId: ctx.runId,
      });
      return {
        ok: true,
        summary: `Drafted a reply to **${thread.from}** — “${subject}”. It's saved as a draft and hasn't been sent.`,
        data: { draft, thread },
      };
    },
  },
  {
    name: "email.sendDraft",
    label: "Send email",
    category: "email",
    description:
      "Send an existing draft. Sensitive: always requires explicit human approval before the message leaves the outbox.",
    requiresApproval: true,
    sideEffect: true,
    schema: sendSchema,
    describeApproval: async (args, ctx) => {
      const draft = await loadDraft(args.draftId, ctx);
      if (!draft) {
        return {
          title: "Send drafted email",
          detail: `No draft matches “${args.draftId}”, so this send cannot run.`,
        };
      }
      const thread = await ctx.port.getMailThread(draft.threadId);
      return {
        title: `Send reply to ${thread?.from ?? "recipient"}`,
        detail: `${draft.subject}\n\n${draft.body}`,
      };
    },
    run: async (args, ctx) => {
      // The planner can name the thread instead of the draft; resolve both rather
      // than failing a send the user already approved.
      const draft = await loadDraft(args.draftId, ctx);
      if (!draft) {
        return {
          ok: false,
          error: `No draft matches “${args.draftId}”.`,
          summary: `I couldn't find a draft for “${args.draftId}”, so nothing was sent. Ask me to draft the reply again and I'll send the new one.`,
        };
      }
      if (draft.status === "sent") {
        return {
          ok: false,
          error: "Draft already sent.",
          summary: "That draft was already sent — I didn't send it twice.",
        };
      }
      try {
        const receipt = await ctx.port.sendDraft(draft.id);
        return {
          ok: true,
          summary: `Sent **${receipt.subject}** to ${receipt.to}.`,
          data: { receipt },
        };
      } catch (error) {
        const reason = cleanErrorMessage(error, "The send did not complete.");
        return {
          ok: false,
          error: reason,
          summary: `The email didn't go out: ${reason}`,
        };
      }
    },
  },
  {
    name: "calendar.listEvents",
    label: "List calendar",
    category: "calendar",
    description: "List upcoming calendar events for the next N days (default 3).",
    requiresApproval: false,
    sideEffect: false,
    schema: calendarListSchema,
    run: async (args, ctx) => {
      const days = args.days ?? 3;
      const events = await ctx.port.listEvents({ days, now: ctx.now });
      if (events.length === 0) {
        return {
          ok: true,
          summary: `Your calendar is clear for the next ${days} day${days === 1 ? "" : "s"}.`,
          data: { events: [] },
        };
      }
      const lines = events.map(
        (e) =>
          `- **${e.title}** — ${formatEventTime(e.start)} (${upcomingLabel(
            e.start,
            ctx.now,
          )})${e.location ? ` · ${e.location}` : ""}`,
      );
      return {
        ok: true,
        summary: `**Next ${events.length} event${events.length === 1 ? "" : "s"}:**\n\n${lines.join("\n")}`,
        data: { events },
      };
    },
  },
  {
    name: "calendar.prepBrief",
    label: "Meeting prep brief",
    category: "calendar",
    description:
      "Build a preparation brief for the next meeting (or a specific event) using event details and related email.",
    requiresApproval: false,
    sideEffect: false,
    schema: prepSchema,
    run: async (args, ctx) => {
      let event = args.eventId ? await ctx.port.getEvent(args.eventId) : null;
      if (!event) {
        const upcoming = await ctx.port.listEvents({ days: 7, now: ctx.now });
        event = upcoming.find((e) => e.end >= ctx.now) ?? upcoming[0] ?? null;
      }
      if (!event) {
        return {
          ok: false,
          error: "No upcoming event.",
          summary: "I couldn't find an upcoming meeting to prepare for.",
        };
      }
      const related = await ctx.port.searchMail({
        query: firstName(event.attendees[0]?.name ?? ""),
        limit: 2,
      });
      const followUps = await ctx.port.listFollowUps();
      const relevantTasks = followUps.filter(
        (t) => t.status === "open" && (t.source === event?.title || !t.source),
      );
      const agenda =
        event.agenda && event.agenda.length > 0
          ? event.agenda
          : [
              "Confirm the goal and decision needed in this meeting",
              "Review open questions from email",
              "Agree owners and next steps",
            ];
      const emailContext =
        related.length > 0
          ? related.map((t) => `- ${t.from}: ${t.subject} — ${firstSentences(t.snippet, 1)}`)
          : ["- No related email found."];
      // Each block is separated by a blank line so the markdown renderer
      // produces real headings, paragraphs, and lists instead of one run-on
      // paragraph.
      const brief = [
        `# ${event.title}\n\n${formatEventTime(event.start)} · ${event.location || "No location"}`,
        `**Attendees:** ${
          event.attendees.map((a) => a.name).join(", ") || "None listed"
        }\n\n**Why it matters:** ${event.description}`,
        `**Suggested agenda:**\n\n${agenda.map((a) => `- ${a}`).join("\n")}`,
        `**From email:**\n\n${emailContext.join("\n")}`,
        ...(relevantTasks.length
          ? [`**Open follow-ups:**\n\n${relevantTasks.map((t) => `- ${t.title}`).join("\n")}`]
          : []),
      ].join("\n\n");
      return {
        ok: true,
        summary: brief,
        data: { event, relatedThreads: related, brief },
      };
    },
  },
  {
    name: "calendar.findConflicts",
    label: "Find conflicts",
    category: "calendar",
    description: "Detect overlapping calendar events in the next N days.",
    requiresApproval: false,
    sideEffect: false,
    schema: conflictsSchema,
    run: async (args, ctx) => {
      const days = args.days ?? 2;
      const events = await ctx.port.listEvents({ days, now: ctx.now });
      const conflicts: { a: CalendarEvent; b: CalendarEvent }[] = [];
      for (let i = 0; i < events.length; i += 1) {
        for (let j = i + 1; j < events.length; j += 1) {
          if (overlaps(events[i], events[j])) conflicts.push({ a: events[i], b: events[j] });
        }
      }
      if (conflicts.length === 0) {
        return {
          ok: true,
          summary: `No scheduling conflicts in the next ${days} day${days === 1 ? "" : "s"}.`,
          data: { conflicts: [] },
        };
      }
      const lines = conflicts.map(
        (c) => `- **${c.a.title}** overlaps **${c.b.title}** on ${formatEventTime(c.a.start)}`,
      );
      return {
        ok: true,
        summary: `Found ${conflicts.length} conflict${
          conflicts.length === 1 ? "" : "s"
        }:\n\n${lines.join("\n")}`,
        data: { conflicts },
      };
    },
  },
  {
    name: "tasks.createFollowUp",
    label: "Create follow-up",
    category: "tasks",
    description: "Create an open follow-up task, optionally linked to a meeting or email.",
    requiresApproval: false,
    sideEffect: true,
    schema: followUpSchema,
    run: async (args, ctx) => {
      const task = await ctx.port.createFollowUp({
        title: args.title,
        dueAt: args.dueAt,
        source: args.source,
      });
      return {
        ok: true,
        summary: `Added follow-up **${task.title}**${task.dueAt ? ` — due ${formatEventTime(task.dueAt)}` : ""}.`,
        data: { task },
      };
    },
  },
  {
    name: "tasks.listOpen",
    label: "List follow-ups",
    category: "tasks",
    description: "List open follow-up tasks.",
    requiresApproval: false,
    sideEffect: false,
    schema: emptySchema,
    run: async (_args, ctx) => {
      const tasks = await ctx.port.listFollowUps();
      const open = tasks.filter((t) => t.status === "open");
      if (open.length === 0) {
        return { ok: true, summary: "No open follow-ups.", data: { tasks: [] } };
      }
      return {
        ok: true,
        summary: `**${open.length} open follow-up${
          open.length === 1 ? "" : "s"
        }:**\n\n${open
          .map((t) => `- ${t.title}${t.dueAt ? ` — due ${formatEventTime(t.dueAt)}` : ""}`)
          .join("\n")}`,
        data: { tasks: open },
      };
    },
  },
];

export const toolRegistry: Record<string, AnyTool> = Object.fromEntries(
  definitions.map((tool) => [tool.name, tool]),
);

export const toolNames = definitions.map((tool) => tool.name);

export function getTool(name: string): AnyTool | undefined {
  return toolRegistry[name];
}

export type ToolCatalogEntry = {
  name: string;
  label: string;
  category: ToolCategory;
  description: string;
  requiresApproval: boolean;
};

export const toolCatalog: ToolCatalogEntry[] = definitions.map((tool) => ({
  name: tool.name,
  label: tool.label,
  category: tool.category,
  description: tool.description,
  requiresApproval: tool.requiresApproval,
}));

/**
 * A decision tool, not an executable one: the planner uses it to ask the user a
 * question. It is never dispatched through the registry, so it cannot run a
 * side effect or bypass validation.
 */
export const clarifyTool = {
  type: "function" as const,
  function: {
    name: "askUser",
    description:
      "Ask the user one clarifying question when the request is ambiguous and the answer changes which action to take. Do not use this for small talk.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "One short, specific question." },
        options: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 4,
          description: "Concrete choices the user can click.",
        },
      },
      required: ["question"],
    },
  },
};

export function validateStep(
  step: PlanStep,
):
  | { ok: true; args: unknown }
  | { ok: false; error: string; missing?: string[] } {
  const tool = getTool(step.tool);
  if (!tool) return { ok: false, error: `Unknown tool “${step.tool}”.` };
  const parsed = tool.schema.safeParse(step.args);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .filter(
        (issue) =>
          (issue as { code?: string }).code === "invalid_type" &&
          String((issue as { received?: string }).received) === "undefined",
      )
      .map((issue) => issue.path.join(".") || "args");
    return {
      ok: false,
      error: `Invalid arguments for ${step.tool}: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "args"} ${i.message}`)
        .join("; ")}`,
      ...(missing.length > 0 ? { missing } : {}),
    };
  }
  return { ok: true, args: parsed.data };
}

export function toolsForLLM(options: { withClarify?: boolean } = {}): {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}[] {
  const tools = definitions.map((tool) => {
    const parameters = z.toJSONSchema(tool.schema, { io: "input" }) as Record<string, unknown>;
    // OpenAI-compatible APIs expect the schema body without the dialect header.
    delete parameters.$schema;
    return {
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters,
      },
    };
  });
  return options.withClarify ? [...tools, clarifyTool] : tools;
}
