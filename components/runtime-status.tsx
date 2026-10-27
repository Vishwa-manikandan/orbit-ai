"use client";

import { useQuery } from "convex/react";
import { KeyRound, Sparkles } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Badge } from "./ui/badge";

/**
 * Reads the actual Convex deployment configuration instead of hard-coding a
 * provider label, so "rules" never masquerades as a working model.
 */
export function RuntimeStatus() {
  const status = useQuery(api.runtime.status);

  return (
    <section className="rounded-xl border border-line bg-panel-2 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-amber" strokeWidth={1.7} />
        <h2 className="text-[13px] font-medium text-text">Agent runtime</h2>
        <Badge
          variant={status?.kind === "llm" ? "lilac" : "neutral"}
          className="ml-auto"
        >
          {status === undefined
            ? "Checking…"
            : status.kind === "llm"
              ? "LLM planner"
              : "Built-in patterns"}
        </Badge>
      </div>

      {status === undefined && (
        <div className="mt-3 space-y-2">
          <div className="h-3 w-4/5 animate-pulse rounded bg-panel-2" />
          <div className="h-3 w-3/5 animate-pulse rounded bg-panel-2" />
        </div>
      )}

      {status?.kind === "llm" && (
        <>
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
            Requests are planned by{" "}
            <code className="rounded border border-line bg-white/5 px-1 py-px font-mono text-[10.5px] text-fog">
              {status.model}
            </code>{" "}
            via{" "}
            <code className="rounded border border-line bg-white/5 px-1 py-px font-mono text-[10.5px] text-fog">
              {status.host}
            </code>
            . The planner sees tool results between turns, so it can chain calls and answer from
            what the tools actually returned.
          </p>
          <p className="mt-2 font-mono text-[9px] tracking-wide text-faint">
            CREDENTIAL · {status.envVar ?? "OPENAI_API_KEY"} · SERVER-SIDE ONLY
          </p>
        </>
      )}

      {status?.kind === "unconfigured" && (
        <>
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
            No language model is configured, so this workspace is running the built-in patterns.
            They cover a small set of request shapes; broad natural-language requests need a model.
          </p>
          {status.reason && (
            <p className="mt-2 text-[10.5px] leading-relaxed text-amber/90">{status.reason}</p>
          )}
        </>
      )}

      <div className="mt-3 rounded-lg border border-line bg-canvas/70 p-3">
        <p className="mono-label mb-2 flex items-center gap-1.5">
          <KeyRound className="size-3" />
          {status?.kind === "llm" ? "Change the provider" : "Enable the LLM planner"}
        </p>
        <pre className="overflow-x-auto font-mono text-[10.5px] leading-relaxed text-muted">
          {`npx convex env set OPENAI_API_KEY sk-...
npx convex env set OPENAI_MODEL gpt-5.6-terra
# Optional OpenAI-compatible gateway:
npx convex env set OPENAI_BASE_URL https://api.openai.com/v1`}
        </pre>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-faint">
        Keys live in the Convex deployment environment, never in the browser bundle. If the provider
        fails, the run stops with a retryable error and the trace records the failure code — the
        built-in patterns never answer in its place.
      </p>
    </section>
  );
}
