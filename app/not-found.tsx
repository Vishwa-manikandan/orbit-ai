import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { OrbitMark } from "@/components/orbit-mark";

export const metadata = { title: "Page not found — Orbit AI" };

export default function NotFound() {
  return (
    <main className="flex h-[calc(100dvh-4rem)] flex-col items-center justify-center px-6 text-center lg:h-dvh">
      <OrbitMark className="size-10 opacity-70" />
      <p className="mono-label mt-4">Error 404</p>
      <h1 className="mt-1 text-lg font-semibold tracking-tight text-text">Page not found</h1>
      <p className="mt-2 max-w-sm text-[12.5px] leading-relaxed text-muted">
        That route doesn&apos;t exist in this workspace. It may have moved, or the link is out of
        date.
      </p>
      <Link
        href="/"
        className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-panel-2 px-4 text-[13px] font-medium text-text transition hover:border-white/20 hover:bg-hover"
      >
        <ArrowLeft className="size-3.5" />
        Back to workspace
      </Link>
    </main>
  );
}
