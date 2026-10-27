"use client";

import { Pencil, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChatMessage as ChatMessageType, RunEntry } from "@/lib/view-types";
import { ApprovalCard } from "./approval-card";
import { CopyButton } from "./markdown";
import { Markdown } from "./markdown";
import { OrbitMark } from "./orbit-mark";
import { ToolTrace } from "./tool-trace";

export function ChatMessage({
  message,
  entry,
  suggestions,
  onSelect,
  onFeedback,
  onRegenerate,
  onEdit,
  busy,
  isLastAssistant,
  onSendAgain,
  showApproval,
}: {
  message: ChatMessageType;
  entry?: RunEntry;
  /** Clarification options the planner offered with its answer. */
  suggestions?: string[];
  onSelect?: (text: string) => void;
  onFeedback?: (value: "up" | "down") => void;
  onRegenerate?: () => void;
  onEdit?: () => void;
  /** True while a run is in flight; actions that would race it are hidden. */
  busy?: boolean;
  isLastAssistant?: boolean;
  /** Re-issues the declined send request from its approval card. */
  onSendAgain?: () => void;
  /** False when a later message already renders this approval's card. */
  showApproval?: boolean;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="group flex animate-fade-up flex-col items-end gap-1">
        <div className="max-w-[85%] rounded-2xl rounded-br-md border border-line bg-panel-2 px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap text-text">
          {message.content}
        </div>
        <div className="flex h-7 items-center gap-0.5 pr-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          <CopyButton getText={() => message.content} label="Copy message" />
          {onEdit && !busy && (
            <button
              type="button"
              onClick={onEdit}
              aria-label="Edit message"
              title="Edit message"
              className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11.5px] text-muted transition hover:bg-hover hover:text-text"
            >
              <Pencil className="size-3.5" strokeWidth={1.9} />
            </button>
          )}
          <span className="ml-1 font-mono text-[10px] text-faint">{formatTime(message.createdAt)}</span>
        </div>
      </div>
    );
  }

  const approval = entry?.approval;
  const failed = entry?.run.status === "failed";

  return (
    <div className="flex animate-fade-up gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-panel-2">
        <OrbitMark className="size-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-medium text-text">Orbit</span>
          {entry && (
            <span className="rounded-full border border-line px-1.5 py-px font-mono text-[9px] tracking-wide text-faint">
              {entry.run.provider}
            </span>
          )}
          <span className="font-mono text-[10px] text-faint">{formatTime(message.createdAt)}</span>
          {failed && <span className="font-mono text-[10px] text-rose">run failed</span>}
        </div>

        <Markdown content={message.content} />

        {suggestions && suggestions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5" data-testid="run-suggestions">
            {suggestions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onSelect?.(option)}
                disabled={busy}
                className="rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-left text-[12px] text-fog transition hover:border-amber/40 hover:text-text disabled:opacity-50"
              >
                {option}
              </button>
            ))}
          </div>
        )}

        {entry && <ToolTrace entry={entry} />}

        {showApproval !== false &&
          message.approvalId &&
          approval &&
          approval.id === message.approvalId && (
            <ApprovalCard
              approval={{ ...approval, runId: entry.run.id }}
              onSendAgain={busy ? undefined : onSendAgain}
              className="mt-3 max-w-[620px]"
            />
          )}

        <div
          className={cn(
            "mt-2 flex h-8 items-center gap-0.5",
            isLastAssistant ? "opacity-100" : "opacity-0 transition group-hover:opacity-100",
          )}
        >
          <CopyButton getText={() => message.content} label="Copy answer" />
          {onFeedback && (
            <>
              <button
                type="button"
                onClick={() => onFeedback("up")}
                aria-label="Good response"
                aria-pressed={message.feedback === "up"}
                title="Good response"
                className={cn(
                  "flex items-center rounded-md px-1.5 py-1 transition hover:bg-hover",
                  message.feedback === "up" ? "text-mint" : "text-muted hover:text-text",
                )}
              >
                <ThumbsUp className="size-3.5" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={() => onFeedback("down")}
                aria-label="Bad response"
                aria-pressed={message.feedback === "down"}
                title="Bad response"
                className={cn(
                  "flex items-center rounded-md px-1.5 py-1 transition hover:bg-hover",
                  message.feedback === "down" ? "text-rose" : "text-muted hover:text-text",
                )}
              >
                <ThumbsDown className="size-3.5" strokeWidth={1.9} />
              </button>
            </>
          )}
          {onRegenerate && !busy && (
            <button
              type="button"
              onClick={onRegenerate}
              aria-label="Regenerate answer"
              title="Regenerate answer"
              className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11.5px] text-muted transition hover:bg-hover hover:text-text"
            >
              <RefreshCw className="size-3.5" strokeWidth={1.9} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
