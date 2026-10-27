"use client";

import { useQuery } from "convex/react";
import { Activity, MessagesSquare, Plus, Settings2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useThread } from "./thread-provider";

const items = [
  { key: "chats", label: "Chats", icon: MessagesSquare },
  { key: "activity", href: "/activity", label: "Activity", icon: Activity },
  { key: "new", label: "New", icon: Plus },
  { key: "approvals", href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { key: "settings", href: "/settings", label: "Settings", icon: Settings2 },
] as const;

export function MobileNav({ onOpenChats }: { onOpenChats: () => void }) {
  const pathname = usePathname();
  const { sessionId, newThread } = useThread();
  const pending = useQuery(api.approvals.pendingCount, sessionId ? { sessionId } : "skip");

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-line bg-panel/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      {items.map((item) => {
        if (item.key === "chats") {
          return (
            <button
              key={item.key}
              type="button"
              onClick={onOpenChats}
              className="flex flex-1 flex-col items-center justify-center gap-1 text-[10.5px] text-faint"
            >
              <item.icon className="size-[19px]" strokeWidth={1.8} />
              {item.label}
            </button>
          );
        }

        if (item.key === "new") {
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => void newThread()}
              className="flex flex-1 flex-col items-center justify-center gap-1 text-[10.5px] text-amber"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-amber text-accent-ink shadow-soft">
                <item.icon className="size-[19px]" strokeWidth={2.2} />
              </span>
              {item.label}
            </button>
          );
        }

        const active = pathname === item.href;
        return (
          <Link
            key={item.key}
            href={item.href!}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex flex-1 flex-col items-center justify-center gap-1 text-[10.5px]",
              active ? "text-text" : "text-faint",
            )}
          >
            <item.icon
              className={cn("size-[19px]", active ? "text-amber" : "text-faint")}
              strokeWidth={1.8}
            />
            {item.label}
            {item.key === "approvals" && Boolean(pending) && (
              <span className="absolute top-2 right-1/2 flex min-w-4 translate-x-[14px] items-center justify-center rounded-full bg-amber px-1 font-mono text-[9px] font-semibold text-accent-ink">
                {pending}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
