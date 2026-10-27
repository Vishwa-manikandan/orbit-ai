"use client";

import { useQuery } from "convex/react";
import { ArrowUpRight, CheckCircle2, Clock3, LockKeyhole, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ApprovalCard } from "./approval-card";
import { PageHeader } from "./page-header";
import { useThread } from "./thread-provider";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { StatusBadge } from "./ui/status";

export function ApprovalsView() {
  const { selectThread, sessionId } = useThread();
  const data = useQuery(api.approvals.list, sessionId ? { sessionId } : "skip");
  const router = useRouter();

  const openThread = (threadId: string) => {
    if (!threadId) return;
    selectThread(threadId as Id<"threads">);
    router.push("/");
  };

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col lg:h-dvh">
      <PageHeader
        kicker="Human in the loop"
        title="Approval queue"
        description="Sensitive actions wait here until a person says yes."
        actions={
          <Badge variant={data?.pending.length ? "amber" : "success"}>
            {data?.pending.length ? (
              <>
                <span className="size-1.5 animate-pulse-soft rounded-full bg-current" />
                {data.pending.length} pending
              </>
            ) : (
              <>
                <CheckCircle2 className="size-3" />
                All clear
              </>
            )}
          </Badge>
        }
      />

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-5 lg:px-8">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-w-0">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="mono-label">Pending review</span>
                <span className="font-mono text-[8.5px] tracking-wide text-faint">
                  {data?.pending.length ?? 0} ITEMS
                </span>
              </div>

              <div className="flex flex-col gap-3">
                {data === undefined &&
                  [0, 1].map((i) => (
                    <div key={i} className="h-56 animate-pulse rounded-xl bg-panel-2" />
                  ))}

                {data?.pending.map((approval) => (
                  <ApprovalCard key={approval.id} approval={approval} className="mt-0" />
                ))}

                {data?.pending.length === 0 && (
                  <div className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-14 text-center">
                    <div className="flex size-10 items-center justify-center rounded-full border border-mint/20 bg-mint/[0.06]">
                      <ShieldCheck className="size-5 text-mint" strokeWidth={1.7} />
                    </div>
                    <p className="mt-3 text-[13px] font-medium text-muted">Nothing waiting</p>
                    <p className="mt-1 max-w-xs text-[11.5px] leading-relaxed text-faint">
                      When Orbit wants to send an email or run another sensitive tool, it will pause
                      here for your approval.
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-7">
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="mono-label">Recent decisions</span>
                  <span className="font-mono text-[8.5px] tracking-wide text-faint">
                    {data?.decided.length ?? 0} RECORDS
                  </span>
                </div>
                <div className="overflow-hidden rounded-xl border border-line">
                  {data?.decided.map((approval, index) => (
                    <div
                      key={approval.id}
                      className={cn(
                        "flex items-center gap-3 px-3.5 py-3",
                        index !== 0 && "border-t border-line",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-full border",
                          approval.status === "approved"
                            ? "border-mint/20 bg-mint/[0.06] text-mint"
                            : "border-line bg-panel-2 text-faint",
                        )}
                      >
                        {approval.status === "approved" ? (
                          <CheckCircle2 className="size-3" />
                        ) : (
                          <LockKeyhole className="size-3" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11.5px] text-fog">{approval.title}</p>
                        <p className="truncate font-mono text-[8.5px] tracking-wide text-faint">
                          {approval.prompt} · {relativeTime(approval.decidedAt ?? approval.requestedAt)}
                        </p>
                      </div>
                      <StatusBadge status={approval.status} />
                      <button
                        type="button"
                        onClick={() => openThread(approval.threadId)}
                        className="flex size-6 items-center justify-center rounded text-faint transition hover:bg-hover hover:text-muted"
                        title="Open conversation"
                      >
                        <ArrowUpRight className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  {data?.decided.length === 0 && (
                    <p className="px-3.5 py-5 text-[11px] text-faint">
                      No approval decisions recorded yet.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <aside className="space-y-3">
              <div className="rounded-xl border border-amber/15 bg-amber/[0.025] p-4">
                <div className="flex items-center gap-2">
                  <div className="flex size-6 items-center justify-center rounded-md border border-amber/20 bg-amber/[0.07]">
                    <LockKeyhole className="size-3 text-amber" />
                  </div>
                  <span className="text-[12px] font-medium text-text">Approval policy</span>
                </div>
                <p className="mt-2.5 text-[11px] leading-relaxed text-muted">
                  Read-only tools run immediately. Outbound or irreversible actions create a
                  pending approval and stop the run before execution.
                </p>
                <div className="mt-3 space-y-2 border-t border-line pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10.5px] text-muted">Read email, calendar</span>
                    <Badge variant="success">Auto</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10.5px] text-muted">Create drafts, tasks</span>
                    <Badge variant="success">Auto</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10.5px] text-muted">Send email</span>
                    <Badge variant="amber">Gated</Badge>
                  </div>
                </div>
                <Link
                  href="/settings"
                  className="mt-1 flex min-h-6 items-center gap-1 py-1 text-[10.5px] text-amber/90 transition hover:text-amber"
                >
                  View the tool registry
                  <ArrowUpRight className="size-3" />
                </Link>
              </div>

              <div className="rounded-xl border border-line bg-panel-2 p-4">
                <div className="flex items-center gap-2">
                  <Clock3 className="size-3.5 text-faint" />
                  <span className="text-[11.5px] font-medium text-fog">What happens next</span>
                </div>
                <ol className="mt-2.5 space-y-2">
                  {[
                    "Approve: the tool executes once and the result is written to the trace.",
                    "Decline: the run completes with no side effects.",
                    "Either decision is recorded in the audit log.",
                  ].map((step, index) => (
                    <li key={step} className="flex gap-2 text-[10.5px] leading-relaxed text-faint">
                      <span className="font-mono text-[9px] text-amber/80">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="rounded-xl border border-line bg-panel-2 p-4">
                <p className="mono-label">Duplicate protection</p>
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">
                  Sent drafts carry a terminal state. Re-approving or resuming an already-executed
                  step is a no-op, and a second send is rejected.
                </p>
              </div>

              <Button variant="ghost" size="sm" className="w-full" disabled>
                <ShieldCheck className="size-3.5" />
                Demo workspace · single user
              </Button>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
