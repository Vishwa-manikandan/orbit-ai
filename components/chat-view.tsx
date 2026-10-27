"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { AlertTriangle, ArrowDown, MessageSquare, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatMessage } from "./chat-message";
import { Composer } from "./composer";
import { OrbitMark } from "./orbit-mark";
import { useThread } from "./thread-provider";
import { Welcome } from "./welcome";
import { WorkspaceHeader } from "./workspace-header";

function TypingBubble({ activity }: { activity?: string }) {
  return (
    <div className="flex animate-fade-up gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-panel-2">
        <OrbitMark className="size-4" />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-text">Orbit</span>
        <div className="flex w-fit items-center gap-1.5 rounded-xl rounded-tl-sm border border-line bg-panel-2 px-3.5 py-3">
          <span className="typing-dot size-1.5 rounded-full bg-amber" />
          <span className="typing-dot size-1.5 rounded-full bg-amber" />
          <span className="typing-dot size-1.5 rounded-full bg-amber" />
        </div>
        <span className="max-w-[300px] truncate font-mono text-[10px] text-faint">
          {activity ?? "working"}
        </span>
      </div>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 items-center border-b border-line px-4">
        <div className="h-3 w-40 animate-pulse rounded bg-hover" />
      </div>
      <div className="mx-auto w-full max-w-[46rem] flex-1 space-y-6 px-5 py-8">
        {[0, 1].map((index) => (
          <div key={index} className="flex gap-3">
            <div className="size-7 animate-pulse rounded-full bg-hover" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-24 animate-pulse rounded bg-hover" />
              <div className="h-3 w-3/4 animate-pulse rounded bg-hover" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-hover" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChatView() {
  const { threadId, sessionId, ready, error: bootError, newThread } = useThread();
  const view = useQuery(
    api.chat.getThread,
    threadId && sessionId ? { threadId, sessionId } : "skip",
  );
  const sendMessage = useAction(api.orchestrator.sendMessage);
  const editMessage = useAction(api.orchestrator.editMessage);
  const regenerate = useAction(api.orchestrator.regenerate);
  const cancelRun = useAction(api.orchestrator.cancelRun);
  const setFeedback = useMutation(api.messages.setFeedback);

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ messageId: Id<"messages">; text: string } | null>(null);
  const [pendingEdit, setPendingEdit] = useState<{
    messageId: Id<"messages">;
    text: string;
    discarded: number;
  } | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const latest = view
    ? Object.values(view.runs).sort((a, b) => b.run.createdAt - a.run.createdAt)[0]
    : undefined;
  const running = sending || latest?.run.status === "running";
  const pending = view?.pendingApprovals[0] ?? null;
  const messages = view?.messages ?? [];
  const lastMessage = messages[messages.length - 1];
  const streaming =
    Boolean(running) &&
    lastMessage?.role === "assistant" &&
    lastMessage.runId === latest?.run.id &&
    lastMessage.content.length > 0;
  const failed = latest?.run.status === "failed" && !pending;
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const lastAssistantId = [...messages].reverse().find((message) => message.role === "assistant")?._id;
  const clarification =
    latest?.run.suggestions && latest.run.status === "completed"
      ? latest.run.suggestions
      : undefined;

  // A decline updates the approval and also writes a cancellation notice that
  // references the same approval. Show its card once, on the first message
  // that references it, so one decision is never rendered twice.
  const firstApprovalMessage = new Map<string, Id<"messages">>();
  for (const message of messages) {
    if (message.approvalId && !firstApprovalMessage.has(message.approvalId)) {
      firstApprovalMessage.set(message.approvalId, message._id);
    }
  }

  const send = useCallback(
    async (text: string) => {
      if (!threadId || !sessionId) return false;
      setSending(true);
      setSendError(null);
      try {
        if (editing) {
          await editMessage({ messageId: editing.messageId, text, sessionId });
          setEditing(null);
        } else {
          await sendMessage({ threadId, text, sessionId });
        }
        setAtBottom(true);
        return true;
      } catch (cause) {
        setSendError(
          cause instanceof Error ? cause.message : "Orbit couldn't start that request.",
        );
        return false;
      } finally {
        setSending(false);
      }
    },
    [editMessage, editing, sendMessage, sessionId, threadId],
  );

  const cancel = useCallback(async () => {
    const runId = latest?.run.id;
    if (!runId || !sessionId) return;
    setSendError(null);
    try {
      await cancelRun({ runId: runId as Id<"agentRuns">, sessionId });
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : "Orbit couldn't stop that run.");
    }
  }, [cancelRun, latest?.run.id, sessionId]);

  const retry = useCallback(async () => {
    if (!lastUserMessage || !sessionId) return;
    setSending(true);
    setSendError(null);
    try {
      await regenerate({ messageId: lastUserMessage._id, sessionId });
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : "Orbit couldn't retry that request.");
    } finally {
      setSending(false);
    }
  }, [lastUserMessage, regenerate, sessionId]);

  const regenerateAnswer = useCallback(async () => {
    if (!lastUserMessage || !sessionId) return;
    setSending(true);
    setSendError(null);
    try {
      await regenerate({ messageId: lastUserMessage._id, sessionId });
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : "Orbit couldn't regenerate that answer.");
    } finally {
      setSending(false);
    }
  }, [lastUserMessage, regenerate, sessionId]);

  const feedback = useCallback(
    async (messageId: Id<"messages">, value: "up" | "down", current?: "up" | "down") => {
      if (!sessionId) return;
      try {
        await setFeedback({
          messageId,
          sessionId,
          value: current === value ? "none" : value,
        });
      } catch (cause) {
        setSendError(cause instanceof Error ? cause.message : "Couldn't save that feedback.");
      }
    },
    [sessionId, setFeedback],
  );

  const requestEdit = useCallback(
    (messageId: Id<"messages">, text: string) => {
      const createdAt = messages.find((message) => message._id === messageId)?.createdAt ?? 0;
      const discarded = messages.filter((message) => message.createdAt > createdAt).length;
      if (discarded > 0) setPendingEdit({ messageId, text, discarded });
      else setEditing({ messageId, text });
    },
    [messages],
  );

  // Only follow the conversation while the reader is already at the end. The
  // scroll is instant on purpose: an animated scroll emits intermediate scroll
  // events, which would be mistaken for the reader moving away.
  useEffect(() => {
    if (!atBottom) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [atBottom, messages.length, latest?.run.status, lastMessage?.content.length]);

  if (!ready || !sessionId) return <ChatSkeleton />;

  if (bootError) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="elevated max-w-md rounded-2xl p-7 text-center">
          <AlertTriangle className="mx-auto size-6 text-rose" />
          <h2 className="mt-3 text-[15px] font-semibold text-text">
            The workspace couldn&apos;t start
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">{bootError}</p>
          <p className="mt-4 rounded-lg border border-line bg-inset p-3 font-mono text-[11.5px] text-faint">
            npx convex dev
          </p>
        </div>
      </div>
    );
  }

  if (!threadId || view === undefined) return <ChatSkeleton />;

  if (view === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <MessageSquare className="size-6 text-faint" />
        <p className="text-[13.5px] text-muted">This conversation no longer exists.</p>
        <Button variant="secondary" size="sm" onClick={() => void newThread()}>
          Start a new conversation
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col lg:h-dvh">
      <WorkspaceHeader
        title={view.thread.title}
        provider={latest?.run.provider ?? "rules"}
        awaiting={view.pendingApprovals.length}
      />

      <div
        ref={scrollRef}
        onScroll={() => {
          const element = scrollRef.current;
          if (!element) return;
          setAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 96);
        }}
        className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto"
        data-testid="chat-transcript"
      >
        <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-7 px-4 py-6 sm:px-6 sm:py-8">
          {messages.length === 0 && <Welcome onPrompt={(text) => void send(text)} />}

          {messages.map((message) => {
            const entry = message.runId ? view.runs[message.runId] : undefined;
            const isLastAssistant = message._id === lastAssistantId && !streaming;
            return (
              <ChatMessage
                key={message._id}
                message={message}
                entry={entry}
                suggestions={
                  message._id === lastAssistantId && message.runId === latest?.run.id
                    ? clarification
                    : undefined
                }
                onSelect={(text) => void send(text)}
                onFeedback={
                  message.role === "assistant"
                    ? (value) => void feedback(message._id, value, message.feedback)
                    : undefined
                }
                onRegenerate={
                  message.role === "assistant" && isLastAssistant ? () => void regenerateAnswer() : undefined
                }
                onEdit={
                  message.role === "user" ? () => requestEdit(message._id, message.content) : undefined
                }
                onSendAgain={
                  message.role === "assistant" && !running && lastUserMessage
                    ? () => void send(lastUserMessage.content)
                    : undefined
                }
                showApproval={
                  !message.approvalId || firstApprovalMessage.get(message.approvalId) === message._id
                }
                busy={running}
                isLastAssistant={isLastAssistant}
              />
            );
          })}

          {running && !pending && !streaming && <TypingBubble activity={latest?.run.activity} />}

          {failed && latest?.run.error && (
            <div className="rounded-xl border border-rose/25 bg-rose/[0.06] p-3.5">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-text">That request stopped</p>
                  {/* The actionable explanation is the assistant message above;
                      the raw provider text stays in the trace, not the thread. Only name
                      steps when there were some — a run that died on its first planner
                      call has no tool steps and must not send the reader looking. */}
                  <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                    {latest.executions.length === 0
                      ? "The message above explains why. No tool step ran — the run stopped before the planner chose one — so the trace holds the failure code and the provider's own response."
                      : `The message above explains why. The trace has the failure code and the ${
                          latest.executions.length
                        } step${latest.executions.length === 1 ? "" : "s"} that ran.`}
                  </p>
                  {latest.run.errorCode && (
                    <p className="mt-1 font-mono text-[10px] text-faint">{latest.run.errorCode}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void retry()}
                  disabled={sending}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[12px] text-text transition hover:border-amber/40 disabled:opacity-50"
                >
                  <RotateCcw className="size-3.5" />
                  Retry
                </button>
              </div>
            </div>
          )}

          <div ref={bottomRef} className="h-px w-full" />
        </div>

        {!atBottom && (
          <button
            type="button"
            onClick={() => {
              scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
              setAtBottom(true);
            }}
            aria-label="Jump to latest message"
            className="popover sticky bottom-3 left-1/2 z-20 mx-auto flex size-9 -translate-x-0 items-center justify-center rounded-full text-muted transition hover:text-text"
          >
            <ArrowDown className="size-4" />
          </button>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-canvas/90 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-[46rem] px-4 pt-3 pb-3 sm:px-6 sm:pb-4">
          {sendError && (
            <div className="mb-2.5 flex items-start gap-2 rounded-lg border border-rose/25 bg-rose/[0.07] px-3 py-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-rose" />
              <p className="flex-1 text-[12.5px] leading-relaxed text-rose">{sendError}</p>
              <button
                type="button"
                onClick={() => setSendError(null)}
                aria-label="Dismiss error"
                className="text-rose/70 transition hover:text-rose"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          {pending && (
            <div className="mb-2.5 flex items-center gap-2 rounded-lg border border-amber/30 bg-amber/[0.07] px-3 py-2">
              <span className="size-1.5 animate-pulse-soft rounded-full bg-amber" />
              <p className="text-[12px] text-amber">
                One action is waiting for your approval above.
              </p>
            </div>
          )}

          <Composer
            onSend={send}
            onStop={running ? cancel : null}
            busy={running}
            blockedReason={
              pending ? "Approve or decline the pending action before sending." : null
            }
            editing={Boolean(editing)}
            initialText={editing?.text}
            onCancelEdit={() => setEditing(null)}
          />
          <div className="mt-2.5 flex items-center justify-between gap-4">
            <span
              className={cn(
                "flex shrink-0 items-center gap-1.5 font-mono text-[10px] tracking-wider",
                running ? "text-amber" : "text-faint",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full",
                  running ? "animate-pulse-soft bg-amber" : "bg-mint",
                )}
              />
              {running ? "EXECUTING" : "READY"}
            </span>
            <p className="text-right text-[11px] leading-snug text-faint">
              Orbit runs read-only tools automatically. Sending email needs your approval.
            </p>
          </div>
        </div>
      </div>

      {pendingEdit && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Edit message"
            className="elevated w-full max-w-sm rounded-2xl p-5"
          >
            <h2 className="text-[15px] font-semibold text-text">Edit this message?</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              Sending the edit replaces your message and discards the{" "}
              {pendingEdit.discarded === 1 ? "reply" : `${pendingEdit.discarded} replies`} after it.
              This can&apos;t be undone.
            </p>
            <div className="mt-4 flex gap-2">
              <Button
                variant="primary"
                size="sm"
                className="flex-1"
                onClick={() => {
                  setEditing({ messageId: pendingEdit.messageId, text: pendingEdit.text });
                  setPendingEdit(null);
                }}
              >
                Continue
              </Button>
              <Button variant="ghost" size="sm" className="flex-1" onClick={() => setPendingEdit(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
