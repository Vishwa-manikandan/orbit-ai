"use client";

import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock3,
  Loader2,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import type { RunEntry } from "@/lib/view-types";
import { toolLabel } from "@/lib/tool-meta";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

function StepIcon({ status }: { status: string }) {
  if (status === "succeeded" || status === "completed")
    return <CheckCircle2 className="size-3.5 text-mint" strokeWidth={1.9} />;
  if (status === "failed" || status === "rejected")
    return <XCircle className="size-3.5 text-rose" strokeWidth={1.9} />;
  if (status === "awaiting_approval")
    return <ShieldAlert className="size-3.5 text-amber" strokeWidth={1.9} />;
  if (status === "running") return <Loader2 className="size-3.5 animate-spin text-lilac" />;
  return <CircleDashed className="size-3.5 text-faint" />;
}

function pretty(value: unknown): string {
  try {
    const json = JSON.stringify(value, null, 2);
    if (!json) return "—";
    return json.length > 1800 ? `${json.slice(0, 1800)}\n…` : json;
  } catch {
    return String(value);
  }
}

export function ToolTrace({ entry }: { entry: RunEntry }) {
  const [open, setOpen] = useState(false);
  const { run, executions, approval } = entry;
  const totalMs = executions.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);
  const active = run.status === "running";
  const pending = run.status === "awaiting_approval";

  const label = executions.length
    ? executions.map((e) => toolLabel(e.tool)).join(" → ")
    : run.plan.map((s) => toolLabel(s.tool)).join(" → ") || "No tools";

  return (
    <div
      className={cn(
        "mt-3 overflow-hidden rounded-lg border transition-colors",
        pending
          ? "border-amber/15 bg-amber/[0.025]"
          : "border-line bg-panel-2",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition hover:bg-hover"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          {active ? (
            <Loader2 className="size-3 animate-spin text-lilac" />
          ) : executions.length > 0 ? (
            <StepIcon status={executions[executions.length - 1].status} />
          ) : (
            <Clock3 className="size-3 text-faint" />
          )}
        </span>
        <span className="mono-label !text-[9px] !tracking-[0.14em]">Trace</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{label}</span>
        <span className="shrink-0 font-mono text-[9.5px] text-faint">
          {executions.length} step{executions.length === 1 ? "" : "s"}
          {totalMs > 0 ? ` · ${totalMs}ms` : ""}
        </span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 text-faint transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="border-t border-line px-2.5 py-2.5">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[9px] text-faint">
              planner: {run.provider}
            </span>
            <span className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[9px] text-faint">
              started {formatTime(run.createdAt)}
            </span>
            {typeof run.turns === "number" && run.turns > 0 && (
              <span className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[9px] text-faint">
                turns {run.turns}
              </span>
            )}
            {approval && (
              <span
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono text-[9px]",
                  approval.status === "approved"
                    ? "border-mint/20 bg-mint/[0.06] text-mint"
                    : approval.status === "rejected"
                      ? "border-rose/20 bg-rose/[0.06] text-rose"
                      : "border-amber/20 bg-amber/[0.06] text-amber",
                )}
              >
                approval: {approval.status}
              </span>
            )}
          </div>

          <div className="relative flex flex-col gap-2.5 pl-1">
            <span className="absolute top-2 bottom-2 left-[6px] w-px bg-panel-2" />
            {run.plan.map((step, index) => {
              const execution = executions.find((e) => e.stepIndex === index);
              return (
                <div key={`${step.tool}-${index}`} className="relative flex gap-2.5 pl-4">
                  <span className="absolute top-1 left-0 rounded-full bg-panel p-0.5">
                    <StepIcon status={execution?.status ?? "pending"} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11.5px] font-medium text-fog">
                        {toolLabel(step.tool)}
                      </span>
                      <span className="font-mono text-[9px] text-faint">{step.tool}</span>
                      {execution?.durationMs !== undefined && (
                        <span className="font-mono text-[9px] text-faint">
                          {execution.durationMs}ms
                        </span>
                      )}
                      {(execution?.attempts ?? 1) > 1 && (
                        <span className="font-mono text-[9px] text-amber">
                          {execution?.attempts} attempts
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[10.5px] leading-relaxed text-faint">
                      {step.rationale}
                    </p>
                    {execution?.summary && (
                      <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted">
                        {execution.summary.replace(/\*\*/g, "")}
                      </p>
                    )}
                    {execution?.error && (
                      <p className="mt-1 rounded border border-rose/20 bg-rose/[0.05] px-2 py-1 font-mono text-[10px] text-rose">
                        {execution.error}
                      </p>
                    )}
                    {execution && (execution.result !== undefined || execution.args !== undefined) && (
                      <div className="mt-1.5 flex flex-wrap gap-3">
                        <details className="group/details">
                          <summary className="cursor-pointer font-mono text-[9.5px] text-faint hover:text-muted">
                            arguments
                          </summary>
                          <pre className="scrollbar-thin mt-1 max-h-40 overflow-auto rounded border border-line bg-canvas/70 p-2 font-mono text-[10px] leading-relaxed text-muted">
                            {pretty(execution.args)}
                          </pre>
                        </details>
                        {execution.result !== undefined && (
                          <details className="group/details">
                            <summary className="cursor-pointer font-mono text-[9.5px] text-faint hover:text-muted">
                              result
                            </summary>
                            <pre className="scrollbar-thin mt-1 max-h-40 overflow-auto rounded border border-line bg-canvas/70 p-2 font-mono text-[10px] leading-relaxed text-muted">
                              {pretty(execution.result)}
                            </pre>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {run.plan.length === 0 && (
              <p className="pl-4 text-[11px] text-faint">No tool steps in this run.</p>
            )}
          </div>

          {run.error && (
            <div className="mt-2.5 rounded border border-rose/20 bg-rose/[0.05] px-2.5 py-2">
              <p className="mono-label !text-rose/80">
                Run error{run.errorCode ? ` · ${run.errorCode}` : ""}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-rose">{run.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
