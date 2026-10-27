import { query } from "./_generated/server";
import { describeProvider } from "./lib/llmProvider";

/**
 * The single source of truth for "what is actually wired up?". The UI reads it
 * instead of hard-coding a provider label. Provider credentials stay on the
 * deployment; only the model name, host, env var name, and a reason are exposed.
 */
export const status = query({
  args: {},
  handler: async () => {
    const descriptor = describeProvider(process.env as Record<string, string | undefined>);
    return {
      ...descriptor,
      planner: descriptor.kind === "llm" ? "llm" : "rules",
    };
  },
});
