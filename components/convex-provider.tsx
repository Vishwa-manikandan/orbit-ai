"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useState, type ReactNode } from "react";
import { Terminal } from "lucide-react";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    return url ? new ConvexReactClient(url) : null;
  });

  if (!client) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="elevated w-full max-w-lg rounded-2xl p-8">
          <div className="mb-4 flex size-10 items-center justify-center rounded-xl border border-amber/20 bg-amber/10">
            <Terminal className="size-5 text-amber" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Connect the Convex backend</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Orbit needs a Convex deployment. Start the local backend once to generate{" "}
            <code className="rounded border border-line bg-white/5 px-1.5 py-0.5 font-mono text-[12px]">
              NEXT_PUBLIC_CONVEX_URL
            </code>
            , then restart the dev server.
          </p>
          <pre className="mt-5 overflow-x-auto rounded-lg border border-line bg-panel-2 p-4 font-mono text-[12.5px] text-fog">
            <code>{"npx convex dev"}</code>
          </pre>
          <p className="mt-4 text-xs text-faint">
            Convex 1.47 creates an anonymous local deployment — no account required.
          </p>
        </div>
      </main>
    );
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
