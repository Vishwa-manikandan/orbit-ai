"use client";

import { useQuery } from "convex/react";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Loader2,
  ShieldAlert,
  Terminal,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDateTime, relativeTime } from "@/lib/format";
import { toolLabel } from "@/lib/tool-meta";
import type { ActivityRun } from "@/lib/view-types";
import { cn } from "@/lib/utils";
import { PageHeader } from "./page-header";
import { useThread } from "./thread-provider";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { StatusBadge, statusTextClass } from "./ui/status";

const filters = [
  { key: "all", label: "All" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
  { key: "awaiting_approval", label: "Awaiting" },
] as const;

function pretty(value: unknown): string {
  try {
    const json = JSON.stringify(value, null, 2);
    if (!json) return "—";
    return json.length > 1400 ? `${json.slice(0, 1400)}\n…` : json;
  } catch {
    return String(value);
  }
}

function StatCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  sub: string;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-panel-2 p-3.5">
      <div className="flex items-center justify-between">
        <span className="mono-label">{label}</span>
        <span className={cn("flex size-6 items-center justify-center rounded-md border", tone)}>
          {icon}
        </span>
      </div>
      <p className="mt-2.5 text-[22px] leading-none font-semibold tracking-tight text-text">
        {value}
      </p>
      <p className="mt-1.5 text-[10.5px] text-faint">{sub}</p>
    </div>
  );
}

function AuditRow({ action, subject, createdAt }: { action: string; subject: string; createdAt: number }) {
  const label = action.replace(/[._]/g, " ");
  const tone = action.includes("failed") || action.includes("rejected")
    ? "text-rose"
    : action.includes("approval")
      ? "text-amber"
      : action.includes("succeeded") || action.includes("completed")
        ? "text-mint"
        : "text-muted";
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-current opacity-60" />
      <div className="min-w-0 flex-1">
        <p className={cn("text-[10.5px] capitalize", tone)}>{label}</p>
        <p className="truncate text-[10px] text-faint">{subject}</p>
      </div>
      <span className="shrink-0 font-mono text-[8.5px] text-faint/80">
        {relativeTime(createdAt)}
      </span>
    </div>
  );
}

function RunCard({ run }: { run: ActivityRun }) {
  const [open, setOpen] = useState(false);
  const { selectThread } = useThread();
  const router = useRouter();
  const duration = run.executions.reduce((sum, execution) => sum + (execution.durationMs ?? 0), 0);
  const failedSteps = run.executions.filter((e) => e.status === "failed").length;

  const openThread = () => {
    selectThread(run.threadId as Id<"threads">);
    router.push("/");
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-panel-2 transition-colors",
        open ? "border-amber/30" : "border-line hover:border-faint/40",
      )}
    >
      <div className="flex items-start gap-3 p-3.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          aria-expanded={open}
          data-testid="run-row"
        >
          <span
            className={cn(
              "mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border",
              run.status === "failed"
                ? "border-rose/20 bg-rose/[0.06] text-rose"
                : run.status === "awaiting_approval"
                  ? "border-amber/20 bg-amber/[0.06] text-amber"
                  : run.status === "running"
                    ? "border-lilac/20 bg-lilac/[0.06] text-lilac"
                    : "border-mint/20 bg-mint/[0.06] text-mint",
            )}
          >
            {run.status === "failed" ? (
              <XCircle className="size-3.5" />
            ) : run.status === "awaiting_approval" ? (
              <ShieldAlert className="size-3.5" />
            ) : run.status === "running" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[12.5px] font-medium text-text">{run.prompt}</span>
              <StatusBadge status={run.status} />
              {failedSteps > 0 && (
                <Badge variant="danger">
                  {failedSteps} failed step{failedSteps === 1 ? "" : "s"}
                </Badge>
              )}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[9px] tracking-wide text-faint">
              <span>{relativeTime(run.createdAt)}</span>
              <span>·</span>
              <span className="max-w-[180px] truncate">{run.threadTitle}</span>
              <span>·</span>
              <span>{run.provider}</span>
              {typeof run.turns === "number" && run.turns > 1 && (
                <>
                  <span>·</span>
                  <span>{run.turns} turns</span>
                </>
              )}
              <span>·</span>
              <span>
                {run.executions.length} step{run.executions.length === 1 ? "" : "s"}
              </span>
              {duration > 0 && (
                <>
                  <span>·</span>
                  <span>{duration}ms tool time</span>
                </>
              )}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="mt-0.5 flex size-6 items-center justify-center rounded-md text-faint transition hover:bg-hover hover:text-muted"
          aria-label={open ? "Collapse run" : "Expand run"}
        >
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <div className="border-t border-line bg-canvas/30 px-3.5 py-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <p className="mono-label mb-2">Plan</p>
              <div className="flex flex-col gap-2">
                {run.executions.map((execution) => (
                  <div
                    key={execution.id}
                    className="rounded-lg border border-line bg-panel-2 p-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "size-1.5 rounded-full bg-current",
                          statusTextClass(execution.status),
                        )}
                      />
                      <span className="text-[11px] font-medium text-fog">
                        {toolLabel(execution.tool)}
                      </span>
                      <span className="font-mono text-[8.5px] text-faint">{execution.tool}</span>
                      {execution.requiresApproval && <Badge variant="amber">Approval</Badge>}
                      {(execution.attempts ?? 1) > 1 && (
                        <Badge variant="danger">{execution.attempts} attempts</Badge>
                      )}
                      <span className="ml-auto font-mono text-[8.5px] text-faint">
                        {execution.durationMs !== undefined ? `${execution.durationMs}ms` : ""}
                      </span>
                    </div>
                    {execution.summary && (
                      <p className="mt-1.5 line-clamp-3 text-[10.5px] leading-relaxed text-muted">
                        {execution.summary.replace(/\*\*/g, "")}
                      </p>
                    )}
                    {execution.error && (
                      <p className="mt-1.5 rounded border border-rose/20 bg-rose/[0.05] px-2 py-1 font-mono text-[9.5px] text-rose">
                        {execution.error}
                      </p>
                    )}
                    <details className="mt-1.5">
                      <summary className="cursor-pointer font-mono text-[8.5px] tracking-wide text-faint hover:text-muted">
                        ARGS + RESULT
                      </summary>
                      <div className="mt-1.5 grid gap-1.5">
                        <pre className="scrollbar-thin max-h-40 overflow-auto rounded border border-line bg-canvas/80 p-2 font-mono text-[9.5px] leading-relaxed text-muted">
                          {pretty(execution.args)}
                        </pre>
                        {execution.result !== undefined && (
                          <pre className="scrollbar-thin max-h-40 overflow-auto rounded border border-line bg-canvas/80 p-2 font-mono text-[9.5px] leading-relaxed text-muted">
                            {pretty(execution.result)}
                          </pre>
                        )}
                      </div>
                    </details>
                  </div>
                ))}
                {run.executions.length === 0 && (
                  <p className="text-[10.5px] text-faint">No tool executions recorded.</p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <p className="mono-label mb-2">Outcome</p>
                <div className="rounded-lg border border-line bg-panel-2 p-2.5">
                  <p className="text-[11px] leading-relaxed text-muted">
                    {run.summary?.replace(/\*\*/g, "") ??
                      run.error ??
                      "This run has not produced a final summary yet."}
                  </p>
                  <p className="mt-2 font-mono text-[8.5px] tracking-wide text-faint">
                    STARTED {formatDateTime(run.createdAt).toUpperCase()}
                  </p>
                </div>
              </div>
              <Button variant="secondary" size="sm" className="self-start" onClick={openThread}>
                Open conversation
                <ArrowUpRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ActivityView() {
  const { sessionId } = useThread();
  const data = useQuery(
    api.activity.list,
    sessionId ? { limit: 30, sessionId } : "skip",
  );
  const [filter, setFilter] = useState<(typeof filters)[number]["key"]>("all");

  const runs = data?.runs.filter((run) => (filter === "all" ? true : run.status === filter)) ?? [];
  const counts = {
    all: data?.runs.length ?? 0,
    completed: data?.runs.filter((r) => r.status === "completed").length ?? 0,
    failed: data?.runs.filter((r) => r.status === "failed").length ?? 0,
    awaiting_approval: data?.runs.filter((r) => r.status === "awaiting_approval").length ?? 0,
  };

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col lg:h-dvh">
      <PageHeader
        kicker="Observability"
        title="Execution activity"
        description="Every run, tool call, approval, and audit event."
        actions={
          <Badge variant="neutral">
            <span className="size-1.5 animate-pulse-soft rounded-full bg-mint" />
            Live
          </Badge>
        }
      />

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-5 lg:px-8">
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatCard
              icon={<Activity className="size-3 text-lilac" />}
              label="Runs today"
              value={data?.stats.runsToday ?? "—"}
              sub="Agent invocations since midnight"
              tone="border-lilac/20 bg-lilac/[0.06]"
            />
            <StatCard
              icon={<CheckCircle2 className="size-3 text-mint" />}
              label="Success rate"
              value={data?.stats.successRate !== null && data?.stats.successRate !== undefined ? `${data.stats.successRate}%` : "—"}
              sub="Completed vs. failed runs"
              tone="border-mint/20 bg-mint/[0.06]"
            />
            <StatCard
              icon={<ShieldAlert className="size-3 text-amber" />}
              label="Awaiting"
              value={data?.stats.awaiting ?? "—"}
              sub="Approval-gated executions"
              tone="border-amber/20 bg-amber/[0.06]"
            />
            <StatCard
              icon={<XCircle className="size-3 text-rose" />}
              label="Failed"
              value={data?.stats.failed ?? "—"}
              sub="Interrupted or errored runs"
              tone="border-rose/20 bg-rose/[0.06]"
            />
          </div>

          <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1">
                  {filters.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setFilter(item.key)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] transition",
                        filter === item.key
                          ? "bg-panel-2 text-text"
                          : "text-faint hover:bg-hover hover:text-muted",
                      )}
                    >
                      {item.label}
                      <span className="font-mono text-[8.5px] text-faint">
                        {counts[item.key]}
                      </span>
                    </button>
                  ))}
                </div>
                <span className="font-mono text-[8.5px] tracking-wide text-faint">
                  LATEST {runs.length} RUNS
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {data === undefined &&
                  [0, 1, 2].map((i) => (
                    <div key={i} className="h-20 animate-pulse rounded-xl bg-panel-2" />
                  ))}
                {runs.map((run) => (
                  <RunCard key={run.id} run={run} />
                ))}
                {data && runs.length === 0 && (
                  <div className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
                    <Terminal className="size-5 text-faint" />
                    <p className="mt-3 text-[12.5px] font-medium text-muted">No runs in this view</p>
                    <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-faint">
                      Start a request in the workspace and the full execution trace will appear
                      here.
                    </p>
                  </div>
                )}
              </div>
            </section>

            <aside>
              <div className="rounded-xl border border-line bg-panel-2">
                <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
                  <span className="mono-label">Audit stream</span>
                  <span className="font-mono text-[8.5px] text-faint">
                    {data?.audit.length ?? 0}
                  </span>
                </div>
                <div className="scrollbar-thin max-h-[540px] overflow-y-auto px-3.5 py-2">
                  {data?.audit.map((event) => (
                    <AuditRow
                      key={event._id}
                      action={event.action}
                      subject={event.subject}
                      createdAt={event.createdAt}
                    />
                  ))}
                  {data?.audit.length === 0 && (
                    <p className="py-3 text-[10.5px] text-faint">No audit events yet.</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 border-t border-line px-3.5 py-2 text-[9.5px] text-faint">
                  <Clock3 className="size-3" />
                  Append-only event log
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
