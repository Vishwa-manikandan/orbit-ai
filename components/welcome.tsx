"use client";

import { ArrowUpRight, Mail, CalendarClock, PenLine, ShieldCheck } from "lucide-react";
import { suggestions } from "@/lib/suggestions";
import { OrbitMark } from "./orbit-mark";

const icons = [Mail, CalendarClock, PenLine, ShieldCheck];

export function Welcome({
  onPrompt,
  disabled,
}: {
  onPrompt: (prompt: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[46rem] flex-col items-center px-2 py-8 text-center sm:py-14">
      <OrbitMark className="size-11" />
      <h1 className="mt-5 text-[26px] font-semibold tracking-[-0.02em] text-text sm:text-[30px]">
        What can I help with?
      </h1>
      <p className="mt-2 max-w-md text-[14px] leading-relaxed text-muted">
        Orbit works across your inbox, calendar, and follow-ups. It shows every tool it runs, and
        anything outbound waits for your approval.
      </p>

      <div className="mt-8 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
        {suggestions.map((suggestion, index) => {
          const Icon = icons[index % icons.length];
          return (
            <button
              key={suggestion.prompt}
              type="button"
              onClick={() => onPrompt(suggestion.prompt)}
              disabled={disabled}
              className="group flex items-start gap-3 rounded-xl border border-line bg-panel p-3.5 text-left transition hover:border-amber/35 hover:bg-panel-2 disabled:opacity-50"
            >
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-panel-2 text-amber">
                <Icon className="size-4" strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-[13.5px] font-medium text-text">
                  {suggestion.label}
                  <ArrowUpRight className="size-3 text-faint opacity-0 transition group-hover:opacity-100" />
                </span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                  {suggestion.prompt}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
