import type {
  CalendarEvent,
  Draft,
  FollowUp,
  MailThread,
  SendReceipt,
  WorkspacePort,
} from "@/convex/lib/types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const NOW = Date.UTC(2026, 9, 19, 15, 0, 0);

export type MemoryState = {
  mail: MailThread[];
  drafts: Draft[];
  events: CalendarEvent[];
  tasks: FollowUp[];
};

export function makeState(): MemoryState {
  const mail: MailThread[] = [
    {
      id: "mail_sarah",
      from: "Sarah Chen",
      fromEmail: "sarah@northwindlabs.com",
      subject: "Q3 launch timeline",
      snippet: "Can you confirm the final timeline and send the launch deck by Thursday?",
      unread: true,
      needsAttention: true,
      labels: ["Launch"],
      receivedAt: NOW - 2 * HOUR,
      messages: [
        {
          from: "Sarah Chen",
          sentAt: NOW - 2 * HOUR,
          body: "Can you confirm the final timeline and send the launch deck by Thursday? The onboarding flow is the risk I care about most.",
        },
        {
          from: "Alex Rivera",
          sentAt: NOW - 26 * HOUR,
          body: "Still on track. I'll flag any onboarding risk before Thursday.",
        },
      ],
    },
    {
      id: "mail_marcus",
      from: "Marcus Webb",
      fromEmail: "marcus@northwindlabs.com",
      subject: "Pricing page copy — final pass",
      snippet: "Could you give the copy one last read?",
      unread: true,
      needsAttention: true,
      labels: ["Marketing"],
      receivedAt: NOW - 5 * HOUR,
      messages: [
        {
          from: "Marcus Webb",
          sentAt: NOW - 5 * HOUR,
          body: "Could you give the copy one last read before I hand it to engineering?",
        },
      ],
    },
    {
      id: "mail_priya",
      from: "Priya Raman",
      fromEmail: "priya@northwindlabs.com",
      subject: "Customer call notes: Helio",
      snippet: "They want SSO before renewal.",
      unread: false,
      needsAttention: false,
      labels: ["Customers"],
      receivedAt: NOW - DAY,
      messages: [
        {
          from: "Priya Raman",
          sentAt: NOW - DAY,
          body: "Helio wants SSO before renewal and is open to the design partner program.",
        },
      ],
    },
  ];

  const drafts: Draft[] = [
    {
      id: "draft_sarah",
      threadId: "mail_sarah",
      subject: "Re: Q3 launch timeline",
      body: "Hi Sarah,\n\nWe're on track for Thursday. I'll send the deck tomorrow.\n\nBest,\nAlex",
      status: "draft",
      createdAt: NOW - HOUR,
    },
  ];

  const events: CalendarEvent[] = [
    {
      id: "event_design",
      title: "Design review — Orbit dashboard",
      start: NOW + 2 * HOUR,
      end: NOW + 2 * HOUR + 45 * 60 * 1000,
      location: "Zoom",
      attendees: [
        { name: "Sarah Chen", email: "sarah@northwindlabs.com" },
        { name: "Alex Rivera", email: "alex@northwindlabs.com" },
      ],
      description: "Final walkthrough before the launch cut.",
      agenda: ["Approvals panel density", "Launch owners"],
    },
    {
      id: "event_planning",
      title: "Q3 launch planning",
      start: NOW + 2 * DAY,
      end: NOW + 2 * DAY + HOUR,
      location: "Board room",
      attendees: [{ name: "Marcus Webb", email: "marcus@northwindlabs.com" }],
      description: "Lock scope and owners.",
    },
    {
      id: "event_focus",
      title: "Deep work — roadmap",
      start: NOW + 2 * DAY + 30 * 60 * 1000,
      end: NOW + 2 * DAY + 2 * HOUR,
      location: "Focus block",
      attendees: [{ name: "Alex Rivera", email: "alex@northwindlabs.com" }],
      description: "Protected focus time.",
    },
  ];

  const tasks: FollowUp[] = [
    {
      id: "task_deck",
      title: "Send launch deck to Sarah",
      status: "open",
      dueAt: NOW + DAY,
      source: "Q3 launch timeline",
    },
  ];

  return { mail, drafts, events, tasks };
}

export function createMemoryPort(seed: MemoryState = makeState()): WorkspacePort & {
  state: MemoryState;
} {
  const state = seed;

  return {
    state,
    async searchMail({ query, needsAttention, limit }) {
      const needle = query?.toLowerCase();
      return state.mail
        .filter((thread) => (needsAttention ? thread.needsAttention : true))
        .filter((thread) => {
          if (!needle) return true;
          return [thread.from, thread.fromEmail, thread.subject, thread.snippet, ...thread.messages.map((m) => m.body)]
            .join(" ")
            .toLowerCase()
            .includes(needle);
        })
        .sort((a, b) => b.receivedAt - a.receivedAt)
        .slice(0, limit);
    },
    async getMailThread(id) {
      return state.mail.find((thread) => thread.id === id) ?? null;
    },
    async createDraft({ threadId, subject, body }) {
      const draft: Draft = {
        id: `draft_${state.drafts.length + 1}`,
        threadId,
        subject,
        body,
        status: "draft",
        createdAt: NOW,
      };
      state.drafts.push(draft);
      return draft;
    },
    async getDraft(id) {
      return state.drafts.find((draft) => draft.id === id) ?? null;
    },
    async sendDraft(id): Promise<SendReceipt> {
      const draft = state.drafts.find((item) => item.id === id);
      if (!draft) throw new Error("Draft not found.");
      if (draft.status === "sent") throw new Error("Draft already sent.");
      const thread = state.mail.find((item) => item.id === draft.threadId);
      if (!thread) throw new Error("Thread not found.");
      draft.status = "sent";
      thread.needsAttention = false;
      thread.messages.push({ from: "Alex Rivera", body: draft.body, sentAt: NOW });
      return {
        draftId: draft.id,
        to: thread.fromEmail,
        subject: draft.subject,
        sentAt: NOW,
      };
    },
    async listEvents({ days, now }) {
      const end = now + days * DAY;
      return state.events.filter((event) => event.start >= now - HOUR && event.start < end);
    },
    async getEvent(id) {
      return state.events.find((event) => event.id === id) ?? null;
    },
    async createFollowUp({ title, dueAt, source }) {
      const task: FollowUp = {
        id: `task_${state.tasks.length + 1}`,
        title,
        status: "open",
        dueAt,
        source,
      };
      state.tasks.push(task);
      return task;
    },
    async listFollowUps() {
      return [...state.tasks];
    },
  };
}
