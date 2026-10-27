"use client";

import { ArrowUp, CornerDownLeft, Loader2, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const MAX_LENGTH = 4000;

export function Composer({
  onSend,
  onStop,
  busy,
  blockedReason,
  editing,
  initialText,
  onCancelEdit,
}: {
  onSend: (text: string) => Promise<boolean>;
  /** Present while a run is in flight; renders the stop control. */
  onStop?: (() => void) | null;
  busy: boolean;
  blockedReason?: string | null;
  editing?: boolean;
  initialText?: string;
  onCancelEdit?: () => void;
}) {
  const [text, setText] = useState(initialText ?? "");
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Synchronous guard: state updates flush after the current event, so rapid
  // repeated clicks/enters could otherwise submit the same message twice.
  const inFlightRef = useRef(false);

  useEffect(() => {
    setText(initialText ?? "");
  }, [initialText, editing]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }, [text]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const disabled = busy || sending || Boolean(blockedReason);
  const remaining = MAX_LENGTH - text.length;

  async function submit(value: string) {
    const trimmed = value.trim();
    if (!trimmed || disabled || inFlightRef.current) return;
    inFlightRef.current = true;
    setSending(true);
    try {
      const sent = await onSend(trimmed);
      if (sent) {
        setText("");
        textareaRef.current?.focus();
      }
    } finally {
      inFlightRef.current = false;
      setSending(false);
    }
  }

  return (
    <div className="w-full">
      {editing && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber/30 bg-amber/[0.06] px-3 py-1.5">
          <span className="text-[11.5px] text-amber">Editing your message</span>
          <span className="text-[11.5px] text-faint">· sending replaces the replies after it</span>
          <button
            type="button"
            onClick={() => {
              setText("");
              onCancelEdit?.();
            }}
            className="ml-auto flex items-center gap-1 rounded px-1 text-[11.5px] text-muted transition hover:text-text"
          >
            <X className="size-3" />
            Cancel
          </button>
        </div>
      )}

      <div
        className={cn(
          "rounded-2xl border bg-panel shadow-soft transition-colors",
          focused ? "border-amber/45" : "border-line",
          blockedReason && "opacity-75",
        )}
      >
        <div className="flex items-end gap-2 px-3.5 pt-3 pb-1">
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit(text);
              }
            }}
            disabled={disabled}
            placeholder={
              blockedReason ?? (busy ? "Orbit is working…" : "Ask Orbit to handle something…")
            }
            aria-label="Message Orbit"
            className="scrollbar-thin max-h-[220px] min-h-[30px] w-full resize-none bg-transparent py-1 text-[15px] leading-relaxed text-text outline-none placeholder:text-faint disabled:cursor-not-allowed"
          />
          {busy && onStop ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop response"
              title="Stop response"
              className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-line bg-panel-2 text-fog transition hover:border-rose/40 hover:text-rose"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit(text)}
              disabled={disabled || !text.trim()}
              aria-label="Send message"
              title="Send message"
              className={cn(
                "mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl transition",
                text.trim() && !disabled
                  ? "bg-amber text-accent-ink hover:bg-amber-bright"
                  : "border border-line bg-panel-2 text-faint",
              )}
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" strokeWidth={2.2} />
              )}
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 pb-2">
          <span className="flex items-center gap-1 text-[11px] text-faint">
            <CornerDownLeft className="size-3" />
            Enter to send
          </span>
          <span className="text-[11px] text-faint">Shift + Enter for a new line</span>
          <span
            className={cn(
              "ml-auto font-mono text-[10.5px] tabular-nums",
              remaining < 0 ? "text-rose" : remaining < 200 ? "text-amber" : "text-faint",
            )}
            aria-live="polite"
          >
            {text.length > 0
              ? remaining < 0
                ? `${Math.abs(remaining)} over the limit`
                : `${text.length}/${MAX_LENGTH}`
              : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
