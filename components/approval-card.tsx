"use client";

import { useAction, useMutation } from "convex/react";
import { Check, Loader2, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useThread } from "./thread-provider";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { StatusBadge } from "./ui/status";

export type ApprovalLike = {
  id: string;
  title: string;
  detail: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: number;
  decidedAt?: number;
  runId: string;
};

export function ApprovalCard({
  approval,
  className,
  onSendAgain,
}: {
  approval: ApprovalLike;
  className?: string;
  /** Re-issues the original send request after a decline (re-approval gate). */
  onSendAgain?: (() => void) | null;
}) {
  const decide = useMutation(api.approvals.decide);
  const resumeRun = useAction(api.orchestrator.resumeRun);
  const { sessionId } = useThread();
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = approval.status === "pending";
  const detailLines = approval.detail.split("\n");
  const subject = detailLines[0]?.startsWith("Tool:") ? null : detailLines[0];
  const body = (subject ? detailLines.slice(1) : detailLines).join("\n").trim();

  async function approve() {
    if (!sessionId) return;
    setBusy("approve");
    setError(null);
    try {
      await decide({
        approvalId: approval.id as Id<"approvals">,
        decision: "approved",
        sessionId,
      });
      await resumeRun({ runId: approval.runId as Id<"agentRuns">, sessionId });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The approval was recorded but the run could not resume.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function decline() {
    if (!sessionId) return;
    setBusy("decline");
    setError(null);
    try {
      await decide({
        approvalId: approval.id as Id<"approvals">,
        decision: "rejected",
        sessionId,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not decline this action.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      data-testid="approval-card"
      className={cn(
        "mt-3 overflow-hidden rounded-xl border",
        pending
          ? "border-amber/25 bg-gradient-to-b from-amber/[0.07] to-amber/[0.015]"
          : approval.status === "approved"
            ? "border-mint/20 bg-mint/[0.03]"
            : "border-line bg-panel-2",
        className,
      )}
    >
      <div className="flex items-start gap-3 px-4 pt-3.5">
        <div
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border",
            pending
              ? "border-amber/25 bg-amber/10 text-amber"
              : approval.status === "approved"
                ? "border-mint/25 bg-mint/10 text-mint"
                : "border-line bg-panel-2 text-faint",
          )}
        >
          <ShieldAlert className="size-3.5" strokeWidth={1.9} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-medium text-text">{approval.title}</p>
            <StatusBadge status={approval.status} />
          </div>
          <p className="mt-0.5 font-mono text-[9.5px] tracking-wide text-faint">
            {pending
              ? `APPROVAL REQUIRED · REQUESTED ${relativeTime(approval.requestedAt).toUpperCase()}`
              : `${approval.status.toUpperCase()}${
                  approval.decidedAt ? ` ${relativeTime(approval.decidedAt).toUpperCase()}` : ""
                }`}
          </p>
        </div>
      </div>

      {pending ? (
        <div className="px-4 pt-3">
          <div className="scrollbar-thin max-h-56 overflow-y-auto rounded-lg border border-line bg-canvas/45 px-3.5 py-3">
            {subject && (
              <p className="mb-2 border-b border-line pb-2 text-[11.5px] font-medium text-fog">
                {subject}
              </p>
            )}
            <pre className="font-sans text-[12px] leading-relaxed whitespace-pre-wrap text-muted">
              {body || "No additional detail."}
            </pre>
          </div>
        </div>
      ) : (
        <details className="px-4 pt-3">
          <summary className="cursor-pointer font-mono text-[9.5px] tracking-wide text-faint transition hover:text-muted">
            VIEW {approval.status === "approved" ? "APPROVED" : "DECLINED"} MESSAGE
          </summary>
          <div className="scrollbar-thin mt-2 max-h-56 overflow-y-auto rounded-lg border border-line bg-canvas/45 px-3.5 py-3">
            {subject && (
              <p className="mb-2 border-b border-line pb-2 text-[11.5px] font-medium text-fog">
                {subject}
              </p>
            )}
            <pre className="font-sans text-[12px] leading-relaxed whitespace-pre-wrap text-muted">
              {body || "No additional detail."}
            </pre>
          </div>
        </details>
      )}

      {error && (
        <p className="mx-4 mt-2.5 rounded border border-rose/20 bg-rose/[0.05] px-2.5 py-2 text-[11px] text-rose">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 px-4 py-3.5">
        {pending ? (
          <>
            <Button
              variant="approve"
              size="sm"
              onClick={() => void approve()}
              disabled={busy !== null}
            >
              {busy === "approve" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" strokeWidth={2.2} />
              )}
              Approve &amp; execute
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted hover:text-rose"
              onClick={() => void decline()}
              disabled={busy !== null}
            >
              {busy === "decline" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <X className="size-3.5" />
              )}
              Decline
            </Button>
            <span className="ml-auto text-[10px] text-faint">
              Runs immediately after approval
            </span>
          </>
        ) : (
          <div className="flex w-full flex-wrap items-center gap-2">
            <Badge variant={approval.status === "approved" ? "success" : "danger"}>
              {approval.status === "approved" ? "Approved by Alex" : "Declined by Alex"}
            </Badge>
            <span className="text-[10.5px] text-faint">
              {approval.status === "approved"
                ? "Execution resumed and recorded in the trace."
                : "No action was executed."}
            </span>
            {approval.status === "rejected" && onSendAgain && (
              <Button
                variant="secondary"
                size="sm"
                className="ml-auto"
                onClick={onSendAgain}
                disabled={busy !== null}
              >
                Send it
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
