"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Activity,
  Archive,
  ArchiveRestore,
  Check,
  ChevronsLeft,
  ChevronsRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OrbitMark } from "./orbit-mark";
import { ThemeToggle } from "./theme-toggle";
import { useThread } from "./thread-provider";

type Conversation = FunctionReturnType<typeof api.threads.list>[number];

const DAY = 24 * 60 * 60 * 1000;

function groupLabel(timestamp: number): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (timestamp >= today) return "Today";
  if (timestamp >= today - DAY) return "Yesterday";
  if (timestamp >= today - 7 * DAY) return "Previous 7 days";
  return "Older";
}

function groupConversations(items: Conversation[]): { label: string; items: Conversation[] }[] {
  const groups = new Map<string, Conversation[]>();
  for (const item of items) {
    const label = groupLabel(item.updatedAt);
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return [...groups.entries()].map(([label, entries]) => ({ label, items: entries }));
}

const navItems = [
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

type SidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
};

export function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, onMobileOpenChange }: SidebarProps) {
  return (
    <>
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 border-r border-line bg-panel/70 backdrop-blur-xl transition-[width] duration-200 lg:flex lg:flex-col",
          collapsed ? "w-[68px]" : "w-[272px]",
        )}
        data-collapsed={collapsed ? "true" : "false"}
      >
        <SidebarBody
          variant="desktop"
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          onNavigate={() => undefined}
        />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close conversations"
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
            onClick={() => onMobileOpenChange(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Conversations"
            className="absolute inset-y-0 left-0 flex w-[86%] max-w-[330px] flex-col border-r border-line bg-panel shadow-pop"
          >
            <SidebarBody
              variant="mobile"
              collapsed={false}
              onToggleCollapsed={() => onMobileOpenChange(false)}
              onNavigate={() => onMobileOpenChange(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}

function SidebarBody({
  variant,
  collapsed,
  onToggleCollapsed,
  onNavigate,
}: {
  variant: "desktop" | "mobile";
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { threadId, sessionId, selectThread, newThread } = useThread();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [showArchived, setShowArchived] = useState(false);
  const [renamingId, setRenamingId] = useState<Id<"threads"> | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmingId, setConfirmingId] = useState<Id<"threads"> | null>(null);
  const [menuId, setMenuId] = useState<Id<"threads"> | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const threads = useQuery(
    api.threads.list,
    sessionId
      ? { sessionId, archived: showArchived, ...(deferredSearch ? { query: deferredSearch } : {}) }
      : "skip",
  );
  const archivedCount = useQuery(
    api.threads.archivedCount,
    sessionId ? { sessionId } : "skip",
  );
  const pending = useQuery(api.approvals.pendingCount, sessionId ? { sessionId } : "skip");

  const renameThread = useMutation(api.threads.rename);
  const archiveThread = useMutation(api.threads.archive);
  const deleteThread = useMutation(api.threads.remove);

  const expanded = variant === "mobile" || !collapsed;

  useEffect(() => {
    if (!menuId) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuId(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuId]);

  async function run(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "That didn't work. Try again.");
    }
  }

  function openThread(id: Id<"threads">) {
    selectThread(id);
    if (pathname !== "/") router.push("/");
    onNavigate();
  }

  function startRename(conversation: Conversation) {
    setRenamingId(conversation.id);
    setRenameValue(conversation.title);
    setMenuId(null);
  }

  async function commitRename(id: Id<"threads">) {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!sessionId || !title) return;
    await run(() => renameThread({ threadId: id, sessionId, title }));
  }

  async function removeConversation(id: Id<"threads">) {
    if (!sessionId) return;
    setConfirmingId(null);
    setMenuId(null);
    await run(async () => {
      await deleteThread({ threadId: id, sessionId });
      if (id === threadId) await newThread();
    });
  }

  const groups = threads ? groupConversations(threads) : [];

  return (
    <>
      <div className={cn("flex items-center gap-2 px-3 pt-4 pb-3", expanded ? "justify-between" : "justify-center")}>
        <Link
          href="/"
          onClick={onNavigate}
          className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-0.5"
          aria-label="Orbit AI workspace"
        >
          <OrbitMark className="size-7 shrink-0" />
          {expanded && (
            <span className="truncate text-[16px] font-semibold tracking-[-0.01em] text-text">
              Orbit
            </span>
          )}
        </Link>
        {expanded ? (
          <button
            type="button"
            onClick={variant === "mobile" ? onToggleCollapsed : onToggleCollapsed}
            aria-label={variant === "mobile" ? "Close conversations" : "Collapse sidebar"}
            title={variant === "mobile" ? "Close" : "Collapse sidebar"}
            className="flex size-7 items-center justify-center rounded-lg text-faint transition hover:bg-hover hover:text-text"
          >
            {variant === "mobile" ? (
              <X className="size-4" strokeWidth={1.9} />
            ) : (
              <ChevronsLeft className="size-4" strokeWidth={1.9} />
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="flex size-7 items-center justify-center rounded-lg text-faint transition hover:bg-hover hover:text-text"
          >
            <ChevronsRight className="size-4" strokeWidth={1.9} />
          </button>
        )}
      </div>

      <div className={cn("px-3", !expanded && "flex flex-col items-center gap-1")}>
        <button
          type="button"
          onClick={() => {
            void newThread();
            onNavigate();
          }}
          aria-label="New conversation"
          title="New conversation"
          className={cn(
            "flex items-center gap-2 rounded-xl border border-line bg-panel-2 text-[13.5px] font-medium text-text transition hover:border-amber/40 hover:bg-hover",
            expanded ? "h-10 w-full px-3" : "size-10 justify-center",
          )}
        >
          <Plus className="size-4" strokeWidth={2} />
          {expanded && "New chat"}
        </button>
      </div>

      {expanded ? (
        <div className="px-3 pt-3">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-canvas/60 px-2.5 text-muted focus-within:border-amber/40">
            <Search className="size-3.5 shrink-0" strokeWidth={1.9} />
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
              data-testid="sidebar-search"
              className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="rounded text-faint transition hover:text-text"
              >
                <X className="size-3.5" />
              </button>
            )}
          </label>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            onToggleCollapsed();
            window.setTimeout(() => searchRef.current?.focus(), 220);
          }}
          aria-label="Search conversations"
          title="Search conversations"
          className="mx-3 mt-3 flex size-10 items-center justify-center rounded-xl text-faint transition hover:bg-hover hover:text-text"
        >
          <Search className="size-4" strokeWidth={1.9} />
        </button>
      )}

      {actionError && expanded && (
        <p className="mx-3 mt-2 rounded-md border border-rose/25 bg-rose/10 px-2 py-1.5 text-[11.5px] text-rose">
          {actionError}
        </p>
      )}

      {expanded && (
        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-4 pb-1.5">
            <span className="mono-label">{showArchived ? "Archived" : "Conversations"}</span>
            {threads && <span className="font-mono text-[10px] text-faint">{threads.length}</span>}
          </div>

          <div
            className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2"
            data-testid="conversation-list"
          >
            {threads === undefined && (
              <div className="space-y-1 px-1">
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className="h-9 animate-pulse rounded-lg bg-hover" />
                ))}
              </div>
            )}

            {threads?.length === 0 && (
              <p className="px-2.5 py-3 text-[12.5px] leading-relaxed text-faint">
                {showArchived
                  ? "No archived conversations."
                  : deferredSearch
                    ? `No conversations match “${deferredSearch}”.`
                    : "No conversations yet. Start one to see it here."}
              </p>
            )}

            {groups.map((group) => (
              <section key={group.label} className="mb-1">
                <h2 className="px-2.5 pt-2 pb-1 text-[10.5px] font-medium text-faint">{group.label}</h2>
                <ul className="flex flex-col">
                  {group.items.map((conversation) => {
                    const active = conversation.id === threadId && !showArchived;
                    const renaming = renamingId === conversation.id;
                    const menuOpen = menuId === conversation.id;

                    return (
                      <li key={conversation.id} className="relative">
                        {renaming ? (
                          <div className="flex items-center gap-1 rounded-lg border border-amber/40 bg-panel-2 px-2 py-1">
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={(event) => setRenameValue(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") void commitRename(conversation.id);
                                if (event.key === "Escape") setRenamingId(null);
                              }}
                              aria-label="Conversation title"
                              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => void commitRename(conversation.id)}
                              aria-label="Save title"
                              className="rounded p-0.5 text-mint transition hover:bg-hover"
                            >
                              <Check className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenamingId(null)}
                              aria-label="Cancel rename"
                              className="rounded p-0.5 text-faint transition hover:bg-hover"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div
                            className={cn(
                              "group flex items-center gap-1 rounded-lg pr-1 transition",
                              active ? "bg-hover" : "hover:bg-hover",
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => openThread(conversation.id)}
                              aria-current={active ? "page" : undefined}
                              data-testid="conversation-item"
                              className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left"
                            >
                              <span className="flex w-full items-center gap-2">
                                <span
                                  className={cn(
                                    "truncate text-[13px]",
                                    active ? "font-medium text-text" : "text-fog",
                                  )}
                                >
                                  {conversation.title}
                                </span>
                                <span className="ml-auto shrink-0 font-mono text-[9.5px] text-faint">
                                  {relativeTime(conversation.updatedAt)}
                                </span>
                              </span>
                              <span className="line-clamp-1 w-full text-[11.5px] text-faint">
                                {conversation.preview}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setMenuId(menuOpen ? null : conversation.id)}
                              aria-label={`Actions for ${conversation.title}`}
                              aria-haspopup="menu"
                              aria-expanded={menuOpen}
                              data-testid="conversation-menu-button"
                              className={cn(
                                "flex size-7 shrink-0 items-center justify-center rounded-md text-faint transition hover:bg-panel-3 hover:text-text",
                                menuOpen ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
                              )}
                            >
                              <MoreHorizontal className="size-4" />
                            </button>
                          </div>
                        )}

                        {menuOpen && (
                          <>
                            <button
                              type="button"
                              aria-label="Dismiss menu"
                              className="fixed inset-0 z-10 cursor-default"
                              onClick={() => setMenuId(null)}
                            />
                            <div
                              role="menu"
                              aria-label={`Actions for ${conversation.title}`}
                              data-testid="conversation-menu"
                              className="popover absolute right-1 top-full z-20 mt-0.5 w-44 p-1"
                            >
                              {confirmingId === conversation.id ? (
                                <div className="px-2 py-1.5">
                                  <p className="text-[12px] leading-snug text-fog">
                                    Delete this conversation permanently?
                                  </p>
                                  <div className="mt-2 flex gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => void removeConversation(conversation.id)}
                                      className="flex-1 rounded-md bg-rose px-2 py-1 text-[11.5px] font-medium text-white"
                                    >
                                      Delete
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setConfirmingId(null);
                                        setMenuId(null);
                                      }}
                                      className="flex-1 rounded-md border border-line px-2 py-1 text-[11.5px] text-muted"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <MenuItem
                                    icon={Pencil}
                                    label="Rename"
                                    onClick={() => startRename(conversation)}
                                  />
                                  <MenuItem
                                    icon={showArchived ? ArchiveRestore : Archive}
                                    label={showArchived ? "Restore" : "Archive"}
                                    data-testid="archive-action"
                                    onClick={() => {
                                      setMenuId(null);
                                      if (!sessionId) return;
                                      void run(() =>
                                        archiveThread({
                                          threadId: conversation.id,
                                          sessionId,
                                          archived: !showArchived,
                                        }),
                                      );
                                    }}
                                  />
                                  <MenuItem
                                    icon={Trash2}
                                    label="Delete"
                                    destructive
                                    onClick={() => setConfirmingId(conversation.id)}
                                  />
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          <div className="border-t border-line-soft px-3 py-2">
            <button
              type="button"
              onClick={() => {
                setShowArchived((current) => !current);
                setSearch("");
              }}
              data-testid="toggle-archived"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-muted transition hover:bg-hover hover:text-text"
            >
              {showArchived ? (
                <ChevronsLeft className="size-3.5" strokeWidth={1.9} />
              ) : (
                <Archive className="size-3.5" strokeWidth={1.9} />
              )}
              {showArchived ? "Back to conversations" : "Archived"}
              {!showArchived && Boolean(archivedCount) && (
                <span className="ml-auto font-mono text-[10px] text-faint">{archivedCount}</span>
              )}
            </button>
          </div>
        </div>
      )}

      <div className={cn("border-t border-line-soft", expanded ? "p-3" : "flex flex-col items-center gap-1 py-3")}>
        <nav className={cn("flex gap-0.5", expanded ? "flex-col" : "flex-col items-center")} aria-label="Workspace">
          {navItems.map((item) => {
            const active = pathname === item.href;
            const count = item.href === "/approvals" ? pending ?? 0 : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                title={item.label}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg text-[13px] transition",
                  expanded ? "h-9 px-2.5" : "size-10 justify-center",
                  active ? "bg-hover text-text" : "text-muted hover:bg-hover hover:text-text",
                )}
              >
                <item.icon className={cn("size-4", active ? "text-amber" : "text-faint")} strokeWidth={1.9} />
                {expanded && <span className="flex-1">{item.label}</span>}
                {count > 0 && (
                  <span
                    className={cn(
                      "flex min-w-4 items-center justify-center rounded-full bg-amber px-1 font-mono text-[9.5px] font-semibold text-accent-ink",
                      !expanded && "absolute ml-5 -mt-5",
                    )}
                  >
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div
          className={cn(
            "mt-2 flex items-center gap-2 border-t border-line-soft pt-2",
            expanded ? "justify-between px-1" : "flex-col",
          )}
        >
          {expanded && (
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-panel-3 text-[10px] font-semibold text-fog">
                AR
              </span>
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium text-text">Alex Rivera</p>
                <p className="truncate text-[10.5px] text-faint">Local demo</p>
              </div>
            </div>
          )}
          <ThemeToggle />
        </div>
      </div>
    </>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  destructive,
  ...rest
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  destructive?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition",
        destructive
          ? "text-rose hover:bg-rose/10"
          : "text-fog hover:bg-hover hover:text-text",
      )}
      {...rest}
    >
      <Icon className="size-3.5" strokeWidth={1.9} />
      {label}
    </button>
  );
}
