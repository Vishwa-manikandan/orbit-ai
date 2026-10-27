export type Nullable<T> = T | null;

export type MailMessage = {
  from: string;
  body: string;
  sentAt: number;
};

export type MailThread = {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  unread: boolean;
  needsAttention: boolean;
  labels: string[];
  receivedAt: number;
  messages: MailMessage[];
};

export type Draft = {
  id: string;
  threadId: string;
  subject: string;
  body: string;
  status: "draft" | "sent";
  createdAt: number;
};

export type CalendarEvent = {
  id: string;
  title: string;
  start: number;
  end: number;
  location: string;
  attendees: { name: string; email: string }[];
  description: string;
  agenda?: string[];
};

export type FollowUp = {
  id: string;
  title: string;
  status: "open" | "done";
  dueAt?: number;
  source?: string;
};

export type SendReceipt = {
  draftId: string;
  to: string;
  subject: string;
  sentAt: number;
};

/**
 * The boundary between the agent's tools and the outside world.
 * Convex wires this to database-backed mock adapters; tests use an in-memory
 * implementation. Gmail/Calendar adapters can implement the same interface.
 */
export interface WorkspacePort {
  searchMail(input: { query?: string; needsAttention?: boolean; limit: number }): Promise<MailThread[]>;
  getMailThread(id: string): Promise<Nullable<MailThread>>;
  createDraft(input: {
    threadId: string;
    subject: string;
    body: string;
    runId?: string;
  }): Promise<Draft>;
  getDraft(id: string): Promise<Nullable<Draft>>;
  sendDraft(id: string): Promise<SendReceipt>;
  listEvents(input: { days: number; now: number }): Promise<CalendarEvent[]>;
  getEvent(id: string): Promise<Nullable<CalendarEvent>>;
  createFollowUp(input: { title: string; dueAt?: number; source?: string }): Promise<FollowUp>;
  listFollowUps(): Promise<FollowUp[]>;
}

export type ToolCategory = "email" | "calendar" | "tasks";

/** One turn of the conversation as the planner sees it. */
export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
};

/** Everything the runtime knows about a tool without its implementation. */
export type ToolDefinition = {
  name: string;
  label: string;
  category: ToolCategory;
  description: string;
  requiresApproval: boolean;
  /** Creates or mutates state, so it is never retried automatically. */
  sideEffect: boolean;
};

export type ToolOk = {
  ok: true;
  summary: string;
  data: unknown;
};

export type ToolError = {
  ok: false;
  summary: string;
  error: string;
};

export type ToolResult = ToolOk | ToolError;

export type ToolContext = {
  port: WorkspacePort;
  now: number;
  runId?: string;
};

export type PlanStep = {
  tool: string;
  args: unknown;
  rationale: string;
};

export type PlannerContext = {
  now: number;
  prompt: string;
  recentMessages: ConversationMessage[];
  mail: MailThread[];
  drafts: Draft[];
  events: CalendarEvent[];
  tasks: FollowUp[];
  /** Tool results from earlier runs in this conversation, oldest first. */
  priorObservations?: ToolObservation[];
};

/** The outcome of one tool call, fed back to the planner on the next turn. */
export type ToolObservation = {
  stepIndex: number;
  tool: string;
  args: unknown;
  ok: boolean;
  summary: string;
  error?: string;
  data?: unknown;
};

/** The planner wants these tools executed. */
export type PlanDecision = {
  kind: "tools";
  provider: string;
  steps: PlanStep[];
  note?: string;
};

/** The planner can answer without tools (a question, a greeting, a summary). */
export type ReplyDecision = {
  kind: "reply";
  provider: string;
  message: string;
  suggestions?: string[];
};

/** The request is genuinely ambiguous; ask before acting. */
export type ClarifyDecision = {
  kind: "clarify";
  provider: string;
  question: string;
  options: string[];
};

export type AgentDecision = PlanDecision | ReplyDecision | ClarifyDecision;

export type PlannerInput = {
  context: PlannerContext;
  /** Results from tool calls already executed in this run. */
  observations: ToolObservation[];
  turn: number;
};

export type PlannerResult = {
  steps: PlanStep[];
  provider: string;
  note?: string;
  /** A direct answer when no tool is needed. */
  answer?: string;
  /** Follow-up prompts the UI can offer (used by clarification). */
  suggestions?: string[];
  clarification?: { question: string; options: string[] };
  /** True when nothing matched: no steps, no grounded answer. */
  unsupported?: boolean;
};

/** Progress notifications the runtime persists so the UI can stream them. */
export type ExecutionEvent =
  | { type: "plan.created"; runId: string; turn: number; steps: PlanStep[] }
  | { type: "step.started"; runId: string; stepIndex: number; tool: string }
  | { type: "step.succeeded"; runId: string; stepIndex: number; tool: string; durationMs: number }
  | { type: "step.failed"; runId: string; stepIndex: number; tool: string; error: string }
  | { type: "approval.requested"; runId: string; stepIndex: number; tool: string }
  | { type: "run.finished"; runId: string; status: "completed" | "failed"; turns: number };
