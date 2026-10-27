import { AgentError, toAgentError } from "./errors";
import type { AgentDecision, PlanStep, PlannerContext, ToolObservation } from "./types";

export type PlannerFn = (input: {
  context: PlannerContext;
  observations: ToolObservation[];
  turn: number;
}) => AgentDecision | Promise<AgentDecision>;

export type StepOutcome =
  | { status: "executed"; observation: ToolObservation }
  | {
      status: "awaiting_approval";
      approval: { title: string; detail: string; stepIndex: number; tool: string };
    }
  | { status: "failed"; error: AgentError; observation?: ToolObservation };

export type LoopOutcome =
  | {
      status: "cancelled";
      observations: ToolObservation[];
      turns: number;
      provider: string;
    }
  | {
      status: "completed";
      message: string;
      observations: ToolObservation[];
      turns: number;
      provider: string;
      suggestions?: string[];
      /** True when the planner asked a question instead of acting. */
      clarified?: boolean;
      /** True when the step or turn budget ran out before the planner answered. */
      budgetExhausted?: boolean;
    }
  | {
      status: "awaiting_approval";
      observations: ToolObservation[];
      turns: number;
      provider: string;
      stepIndex: number;
      approval: { title: string; detail: string; stepIndex: number; tool: string };
    }
  | {
      status: "failed";
      error: AgentError;
      observations: ToolObservation[];
      turns: number;
      provider: string;
    };

/** Stable key for a planned step, so argument order can't defeat the guard. */
export function stepKey(tool: string, args: unknown): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, stable(item)]),
      );
    }
    return value;
  };
  try {
    return `${tool}:${JSON.stringify(stable(args ?? {}))}`;
  } catch {
    return `${tool}:${String(args)}`;
  }
}

/** Deterministic answer built only from what the tools actually returned. */
export function composeObservations(
  observations: ToolObservation[],
  note?: string,
): string | undefined {
  const usable = observations.filter((observation) => observation.summary);
  if (usable.length === 0) return note;
  const body = usable.map((observation) => observation.summary).join("\n\n");
  return note ? `${note}\n\n${body}` : body;
}

export type RunAgentLoopInput = {
  planner: PlannerFn;
  executeStep: (step: PlanStep, stepIndex: number) => Promise<StepOutcome>;
  context: PlannerContext;
  /** Global step index for the first step of this call (resume continues the run). */
  startIndex?: number;
  /** Model turns per request. Each turn may plan one or more tool calls. */
  maxTurns?: number;
  maxStepsPerTurn?: number;
  /** Results already produced by this run (used when resuming after approval). */
  initialObservations?: ToolObservation[];
  /** Planner label recorded if the planner fails before returning a decision. */
  initialProvider?: string;
  /** Persist a plan before executing it, so the trace shows steps as they appear. */
  onPlan?: (steps: PlanStep[], provider: string, turn: number) => Promise<void> | void;
  /** Short progress line for the UI; called before planning and before each step. */
  onActivity?: (activity: string) => Promise<void> | void;
  /** Cancellation predicate, checked between turns and between steps. */
  shouldStop?: () => boolean | Promise<boolean>;
};

/**
 * Plan → execute → observe → plan again, until the planner answers, asks a
 * question, needs approval, or the budget runs out. Tool results are fed back
 * into the next planning turn, which is what makes multi-step requests work
 * without hard-coded command matching.
 */
export async function runAgentLoop({
  planner,
  executeStep,
  context,
  startIndex = 0,
  maxTurns = 3,
  maxStepsPerTurn = 4,
  initialObservations = [],
  initialProvider = "rules",
  onPlan,
  onActivity,
  shouldStop,
}: RunAgentLoopInput): Promise<LoopOutcome> {
  const observations = [...initialObservations];
  const completedSteps = new Set(
    observations.filter((observation) => observation.ok).map((o) => stepKey(o.tool, o.args)),
  );
  let index = startIndex;
  let provider = initialProvider;
  let turns = 0;
  let lastNote: string | undefined;

  const stopped = async (): Promise<boolean> =>
    shouldStop ? Boolean(await shouldStop()) : false;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    turns = turn;
    if (await stopped()) return { status: "cancelled", observations, turns, provider };
    await onActivity?.(turn === 1 ? "Planning the request…" : "Reviewing tool results…");

    let decision: AgentDecision;
    try {
      decision = await planner({ context, observations: [...observations], turn });
    } catch (error) {
      return {
        status: "failed",
        error: toAgentError(error, "provider_unavailable"),
        observations,
        turns,
        provider,
      };
    }
    provider = decision.provider;

    // A stop can arrive while the model is answering; don't act on a decision
    // the user no longer wants.
    if (await stopped()) return { status: "cancelled", observations, turns, provider };

    if (decision.kind === "reply") {
      // Only a stream cut short by cancellation yields an empty reply (the
      // planner throws for empty completions), so treat it as a stop rather
      // than completing the run with a blank answer.
      if (!decision.message.trim()) {
        return { status: "cancelled", observations, turns, provider };
      }
      return {
        status: "completed",
        message: decision.message,
        suggestions: decision.suggestions,
        observations,
        turns,
        provider,
      };
    }

    if (decision.kind === "clarify") {
      return {
        status: "completed",
        message: decision.question,
        suggestions: decision.options,
        observations,
        turns,
        provider,
        clarified: true,
      };
    }

    lastNote = decision.note;

    // Never execute the same successful call twice in one run, even if the
    // planner asks again after seeing the result.
    const pending: PlanStep[] = [];
    for (const step of decision.steps) {
      if (completedSteps.has(stepKey(step.tool, step.args))) continue;
      pending.push(step);
      if (pending.length === maxStepsPerTurn) break;
    }

    if (pending.length === 0) {
      const message = composeObservations(observations, decision.note);
      if (!message) {
        return {
          status: "failed",
          error: new AgentError({
            code: "plan_invalid",
            message: "The planner produced no executable steps and no answer.",
          }),
          observations,
          turns,
          provider,
        };
      }
      return { status: "completed", message, observations, turns, provider };
    }

    await onPlan?.(pending, provider, turn);

    for (const step of pending) {
      if (await stopped()) return { status: "cancelled", observations, turns, provider };
      await onActivity?.(`Running ${step.tool}…`);
      const outcome = await executeStep(step, index);

      if (outcome.status === "awaiting_approval") {
        return {
          status: "awaiting_approval",
          observations,
          turns,
          provider,
          stepIndex: index,
          approval: outcome.approval,
        };
      }

      if (outcome.status === "failed") {
        if (outcome.observation) observations.push(outcome.observation);
        return {
          status: "failed",
          error: outcome.error,
          observations,
          turns,
          provider,
        };
      }

      observations.push(outcome.observation);
      if (outcome.observation.ok) {
        completedSteps.add(stepKey(step.tool, step.args));
      }
      index += 1;
    }
  }

  return {
    status: "completed",
    message:
      composeObservations(observations, lastNote) ??
      "I used the full step budget without finishing. Ask me to continue if you want me to keep going.",
    observations,
    turns,
    provider,
    budgetExhausted: true,
  };
}
