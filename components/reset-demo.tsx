"use client";

import { useMutation } from "convex/react";
import { Loader2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { Button } from "./ui/button";
import { useThread } from "./thread-provider";

export function ResetDemo() {
  const resetDemo = useMutation(api.seed.resetDemo);
  const { selectThread, sessionId } = useThread();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await resetDemo({ sessionId });
      selectThread(result.threadId);
      router.push("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reset the demo data.");
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <Button
        variant={confirming ? "danger" : "secondary"}
        size="sm"
        onClick={() => void reset()}
        disabled={busy}
        onBlur={() => setConfirming(false)}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
        {busy ? "Resetting…" : confirming ? "Confirm reset" : "Reset demo data"}
      </Button>
      {error && <p className="mt-1.5 text-[10px] text-rose">{error}</p>}
      {!error && (
        <p className="mt-1.5 text-[9.5px] text-faint">
          {confirming ? "Click again to erase local demo state." : "Clears runs and reseeds mocks."}
        </p>
      )}
    </div>
  );
}
