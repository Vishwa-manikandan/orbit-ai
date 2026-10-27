"use client";

import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "./theme-provider";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, ready, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      aria-pressed={theme === "dark"}
      title={`Switch to ${next} theme`}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg text-muted transition hover:bg-hover hover:text-text",
        className,
      )}
    >
      {ready && theme === "light" ? (
        <Moon className="size-4" strokeWidth={1.8} />
      ) : (
        <Sun className="size-4" strokeWidth={1.8} />
      )}
    </button>
  );
}
