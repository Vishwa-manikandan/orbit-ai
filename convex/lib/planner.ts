import type {
  Draft,
  MailThread,
  PlanStep,
  PlannerContext,
  PlannerResult,
  ToolObservation,
} from "./types";

const DAY = 24 * 60 * 60 * 1000;

function allObservations(context: PlannerContext): ToolObservation[] {
  return context.priorObservations ?? [];
}

function observationThreads(observations: ToolObservation[]): MailThread[] {
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    const data = observations[index].data as
      | { thread?: MailThread; threads?: MailThread[] }
      | undefined;
    if (data?.thread) return [data.thread];
    if (data?.threads?.length) return data.threads;
  }
  return [];
}

function threadFromObservations(observations: ToolObservation[]): MailThread | undefined {
  return observationThreads(observations)[0];
}

function draftFromObservations(observations: ToolObservation[]): Draft | undefined {
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    const data = observations[index].data as { draft?: Draft } | undefined;
    if (data?.draft) return data.draft;
  }
  return undefined;
}

/** "the second one", "the last email" — resolve against the previous result set. */
function ordinalThread(prompt: string, observations: ToolObservation[]): MailThread | undefined {
  const match = prompt
    .toLowerCase()
    .match(/\b(first|1st|second|2nd|third|3rd|last|final)\b/);
  if (!match) return undefined;
  const threads = observationThreads(observations);
  if (threads.length === 0) return undefined;
  const word = match[1];
  const position =
    word === "last" || word === "final"
      ? threads.length - 1
      : word === "first" || word === "1st"
        ? 0
        : word === "second" || word === "2nd"
          ? 1
          : 2;
  return threads[position];
}

function contactInPrompt(prompt: string, mail: MailThread[]): MailThread | undefined {
  const lower = prompt.toLowerCase();
  return mail.find((thread) => {
    const first = thread.from.split(/\s+/)[0]?.toLowerCase();
    const full = thread.from.toLowerCase();
    return Boolean(
      (first && first.length > 2 && new RegExp(`\\b${first}\\b`).test(lower)) ||
        (full.length > 2 && lower.includes(full)) ||
        (thread.fromEmail && lower.includes(thread.fromEmail.toLowerCase())),
    );
  });
}

function extractInstructions(prompt: string): string | undefined {
  const match = prompt.match(/\b(?:saying|tell (?:them|her|him)|that)\b[:\s]+(.+)$/i);
  if (!match) return undefined;
  return match[1].trim().replace(/^["']|["']$/g, "").slice(0, 2000);
}

function parseDays(prompt: string, fallback: number): number {
  const lower = prompt.toLowerCase();
  if (lower.includes("today")) return 1;
  if (lower.includes("tomorrow")) return 2;
  if (lower.includes("week")) return 7;
  const match = lower.match(/next (\d+) days?/);
  if (match) return Math.min(14, Math.max(1, Number(match[1])));
  return fallback;
}

function parseDue(prompt: string, now: number): number | undefined {
  const lower = prompt.toLowerCase();
  if (lower.includes("tomorrow")) return now + DAY;
  if (lower.includes("next week")) return now + 7 * DAY;
  if (lower.includes("today")) return now + 6 * 60 * 60 * 1000;
  return undefined;
}

function extractFollowUpTitle(prompt: string, context: PlannerContext): string {
  const match = prompt.match(
    /(?:follow[- ]?up|remind me|add (?:a )?task)(?:\s+(?:with|to|about|on|for))?\s+(.+)/i,
  );
  const raw = match?.[1]
    ?.trim()
    .replace(/\s+(tomorrow|today|next week)$/i, "")
    .replace(/[.?!]$/, "");
  if (raw && raw.length > 1) {
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  const attention = context.mail.find((t) => t.needsAttention);
  if (attention) return `Follow up with ${attention.from} about ${attention.subject}`;
  return "Follow up on open items";
}

/**
 * Deterministic interpreter used when no model is configured, and as the
 * fallback when the configured model is unreachable. It is intentionally
 * conservative: it routes only requests it can ground in the workspace, reads
 * prior tool results for follow-ups, and never sends without approval.
 *
 * This is not the natural-language layer. With a provider configured, the
 * multi-turn model planner in llmPlanner.ts is the primary path.
 */
export function rulesPlanner(context: PlannerContext): PlannerResult {
  const prompt = context.prompt.trim();
  const lower = prompt.toLowerCase();
  const steps: PlanStep[] = [];
  const attention = context.mail.filter((t) => t.needsAttention);
  const observations = allObservations(context);
  const observedThread = threadFromObservations(observations);
  const ordinal = ordinalThread(prompt, observations);
  const contact = contactInPrompt(prompt, context.mail) ?? ordinal;
  const observedDraft = draftFromObservations(observations);
  const latestDraft =
    (observedDraft?.status === "draft" ? observedDraft : undefined) ??
    context.drafts.find((d) => d.status === "draft");

  const otherIntent = /\b(draft|write|compose|follow[- ]?up|remind|add|create)\b/.test(lower);
  const wantsSend = /^(please\s+)?(send|ship|fire it off)\b/.test(lower) && !otherIntent;

  if (wantsSend) {
    const alreadySent = observations.find((o) => o.tool === "email.sendDraft" && o.ok);
    if (alreadySent) {
      // The approval already ran this send; report it instead of planning it again.
      return { provider: "rules", steps: [], answer: alreadySent.summary };
    }
    if (latestDraft) {
      return {
        provider: "rules",
        steps: [
          {
            tool: "email.sendDraft",
            args: { draftId: latestDraft.id },
            rationale:
              "Send the most recent unsent draft. This is sensitive, so it pauses for approval.",
          },
        ],
      };
    }
    return {
      provider: "rules",
      steps: [],
      note: "There's no unsent draft in the outbox. Ask me to draft a reply first — for example, “Draft a reply to Sarah saying I'll share the deck tomorrow.”",
    };
  }

  if (/\b(conflicts?|double[- ]?book(?:ed|ing)?|overlaps?|overlapping)\b/.test(lower)) {
    steps.push({
      tool: "calendar.findConflicts",
      args: { days: parseDays(prompt, 2) },
      rationale: "Check for overlapping events in the requested window.",
    });
    return { provider: "rules", steps };
  }

  if (/\b(prep|prepare|brief|briefing)\b/.test(lower)) {
    steps.push({
      tool: "calendar.prepBrief",
      args: context.events[0] ? { eventId: context.events[0].id } : {},
      rationale: "Build a brief for the next meeting from the event and related email.",
    });
    return { provider: "rules", steps };
  }

  if (/\b(summar\w*|recap|read|catch me up|what did|what does|tl;?dr)\b/.test(lower)) {
    const followUp = /^(and\b|what about|how about|the other|that one)/.test(lower);
    const target =
      contact ?? (followUp ? observedThread : undefined) ?? attention[0] ?? context.mail[0];
    steps.push({
      tool: "email.summarizeThread",
      args: target ? { threadId: target.id } : {},
      rationale: target
        ? `Summarize the thread from ${target.from}.`
        : "Summarize the most relevant email thread.",
    });
    return { provider: "rules", steps };
  }

  if (/\b(draft|reply|respond)\b/.test(lower)) {
    const target = contact ?? observedThread ?? attention[0];
    if (!contact && !observedThread && attention.length > 1) {
      const options = attention
        .slice(0, 3)
        .map((thread) => `Reply to ${thread.from} about ${thread.subject}`);
      return {
        provider: "rules",
        steps: [],
        note: `I can draft a reply to any of the ${attention.length} threads waiting on you. Which one?`,
        answer: `I can draft a reply to any of the ${attention.length} threads waiting on you. Which one?`,
        clarification: { question: "Which thread should I reply to?", options },
        suggestions: options,
      };
    }
    steps.push({
      tool: "email.draftReply",
      args: {
        ...(target ? { threadId: target.id } : {}),
        ...(extractInstructions(prompt) ? { instructions: extractInstructions(prompt) } : {}),
      },
      rationale: target
        ? `Draft a reply in the thread from ${target.from}.`
        : "Find the most relevant thread and draft a reply.",
    });
    return { provider: "rules", steps };
  }

  if (
    /\b(inbox|attention|unread|important|needs? (?:my|a) (?:reply|response|attention)|triage)\b/.test(
      lower,
    )
  ) {
    steps.push({
      tool: "email.searchThreads",
      args: { needsAttention: true, limit: 5 },
      rationale: "Find messages that need a reply.",
    });
    const toSummarize = attention.slice(0, 2);
    for (const thread of toSummarize) {
      steps.push({
        tool: "email.summarizeThread",
        args: { threadId: thread.id },
        rationale: `Pull the key points from ${thread.from}'s message.`,
      });
    }
    return { provider: "rules", steps };
  }

  if (/\b(follow[- ]?up|tasks?|to-?dos?|remind)\b/.test(lower)) {
    const wantsCreate =
      /\b(add|create|new|remind me|make|send)\b/.test(lower) ||
      /\bfollow[- ]?up (?:with|to|about|on|for)\b/.test(lower);
    if (wantsCreate) {
      steps.push({
        tool: "tasks.createFollowUp",
        args: {
          title: extractFollowUpTitle(prompt, context),
          ...(parseDue(prompt, context.now) ? { dueAt: parseDue(prompt, context.now) } : {}),
          ...(contact ? { source: contact.from } : {}),
        },
        rationale: "Capture the requested follow-up as a tracked task.",
      });
    } else {
      steps.push({
        tool: "tasks.listOpen",
        args: {},
        rationale: "Show the user's open follow-ups.",
      });
    }
    return { provider: "rules", steps };
  }

  if (/\b(calendar|schedule|meeting|events?|agenda)\b/.test(lower)) {
    steps.push({
      tool: "calendar.listEvents",
      args: { days: parseDays(prompt, 3) },
      rationale: "List upcoming events for the requested window.",
    });
    return { provider: "rules", steps };
  }

  if (/\b(email|mail|message|thread)\b/.test(lower)) {
    steps.push({
      tool: "email.searchThreads",
      args: {
        ...(contact ? { query: contact.from.split(/\s+/)[0] } : {}),
        limit: 5,
      },
      rationale: contact
        ? `Search the mailbox for mail from ${contact.from}.`
        : "List the most recent messages in the mailbox.",
    });
    return { provider: "rules", steps };
  }

  return {
    provider: "rules",
    steps: [],
    // Neither a tool nor a grounded answer: the request is outside what the
    // deterministic patterns can cover. The caller decides how to explain that.
    unsupported: true,
    note: [
      // The trailing newline starts a real markdown list once the renderer
      // splits the block on the blank line.
      "I can work across your inbox, calendar, and follow-ups. Try one of these:\n",
      "- “What needs my attention?”",
      "- “Summarize the thread from Sarah”",
      "- “Draft a reply to Sarah saying I'll share the launch deck tomorrow”",
      "- “Prepare me for my next meeting”",
      "- “Do I have any conflicts tomorrow?”",
      "- “Add a follow-up with Marcus about the pricing page”",
    ].join("\n"),
  };
}

/**
 * Stated plainly whenever the built-in patterns could not answer and there is
 * no model behind them. Without this the app would look like it understood an
 * open-ended request it cannot actually handle.
 */
export const NO_MODEL_NOTICE =
  "No language model is configured on this deployment, so I can only run the built-in patterns — I can't answer open-ended questions yet. Set `OPENAI_API_KEY` on the Convex deployment to enable them.";

/**
 * Final wording for a plan that produced neither steps nor a direct answer.
 * Only the no-model case is labelled; a configured model never reaches this
 * path, because provider failures fail the run instead of answering from here.
 */
export function plannerFallbackMessage(
  plan: PlannerResult,
  modelConfigured: boolean,
): string {
  const note =
    plan.note ??
    "I couldn't find a safe action for that request. Try asking about your inbox, calendar, or follow-ups.";
  return plan.unsupported && !modelConfigured ? `${NO_MODEL_NOTICE}\n\n${note}` : note;
}

export function composeReply(results: { summary: string; ok: boolean }[]): string {
  if (results.length === 0) return "I didn't run any tools for that request.";
  const successes = results.filter((r) => r.ok);
  if (successes.length === 0) {
    return results.map((r) => r.summary).join("\n\n");
  }
  return successes.map((r) => r.summary).join("\n\n");
}
