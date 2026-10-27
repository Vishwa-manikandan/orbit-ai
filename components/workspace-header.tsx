"use client";

import { Activity, Menu, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useShell } from "./app-shell";
import { ThemeToggle } from "./theme-toggle";

export function WorkspaceHeader({
  title,
  provider,
  awaiting,
}: {
  title: string;
  provider: string;
  awaiting: number;
}) {
  const { openSidebar } = useShell();

  // The label reflects what actually planned this run, not an aspiration.
  const mode = provider.startsWith("llm:")
    ? {
        label: provider.slice(4),
        prefix: "LLM",
        tone: "text-lilac border-lilac/30 bg-lilac/10",
        title: "Planned by the configured language model.",
      }
    : {
        label: "built-in planner",
        prefix: "Local",
        tone: "text-muted border-line bg-panel-2",
        title:
          "No model configured: set OPENAI_API_KEY on the Convex deployment to enable natural-language planning.",
      };

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-canvas/85 px-2 backdrop-blur-xl sm:px-4">
      <button
        type="button"
        onClick={openSidebar}
        aria-label="Open conversations"
        className="flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-hover hover:text-text lg:hidden"
      >
        <Menu className="size-4.5" strokeWidth={1.9} />
      </button>

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <h1 className="truncate text-[14px] font-medium leading-5 text-text">{title}</h1>
        <span
          className={cn(
            "mt-0.5 hidden w-fit items-center gap-1 rounded-full border px-1.5 py-px font-mono text-[9px] tracking-wide sm:flex",
            mode.tone,
          )}
          title={mode.title}
        >
          {mode.prefix} · {mode.label}
        </span>
      </div>

      <Link
        href="/approvals"
        aria-label={awaiting > 0 ? `Approvals, ${awaiting} pending` : "Approvals"}
        className="relative flex h-9 items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-muted transition hover:bg-hover hover:text-text"
      >
        <ShieldCheck className="size-4" strokeWidth={1.9} />
        <span className="hidden sm:inline">Approvals</span>
        {awaiting > 0 && (
          <span className="flex min-w-4 items-center justify-center rounded-full bg-amber px-1 font-mono text-[9.5px] font-semibold text-accent-ink">
            {awaiting}
          </span>
        )}
      </Link>
      <Link
        href="/activity"
        aria-label="Execution activity"
        className="flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-hover hover:text-text"
      >
        <Activity className="size-4" strokeWidth={1.9} />
      </Link>
      <ThemeToggle />
    </header>
  );
}
