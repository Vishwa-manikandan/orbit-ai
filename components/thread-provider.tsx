"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getSessionId } from "@/lib/session";

type ThreadContextValue = {
  threadId: Id<"threads"> | null;
  /** Conversation ownership key; null until it has been read from storage. */
  sessionId: string | null;
  ready: boolean;
  error: string | null;
  selectThread: (id: Id<"threads">) => void;
  newThread: () => Promise<void>;
};

const ThreadContext = createContext<ThreadContextValue | null>(null);

export function ThreadProvider({ children }: { children: ReactNode }) {
  const ensureSeeded = useMutation(api.seed.ensureSeeded);
  const createThread = useMutation(api.threads.create);
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<Id<"threads"> | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSessionId(getSessionId());
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    ensureSeeded({ sessionId })
      .then((result) => {
        if (cancelled) return;
        setThreadId(result.threadId);
        setReady(true);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Could not connect to the workspace.");
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ensureSeeded, sessionId]);

  const selectThread = useCallback((id: Id<"threads">) => {
    setThreadId(id);
  }, []);

  const newThread = useCallback(async () => {
    if (!sessionId) return;
    const id = await createThread({ sessionId });
    setThreadId(id);
    router.push("/");
  }, [createThread, router, sessionId]);

  return (
    <ThreadContext.Provider
      value={{ threadId, sessionId, ready, error, selectThread, newThread }}
    >
      {children}
    </ThreadContext.Provider>
  );
}

export function useThread() {
  const context = useContext(ThreadContext);
  if (!context) throw new Error("useThread must be used inside ThreadProvider.");
  return context;
}
