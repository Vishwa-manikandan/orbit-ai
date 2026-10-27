"use client";

import { Check, Copy } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

export function CopyButton({
  getText,
  label,
  className,
}: {
  getText: () => string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyText(getText());
        if (!ok) return;
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11.5px] text-muted transition hover:bg-hover hover:text-text",
        className,
      )}
    >
      {copied ? (
        <Check className="size-3.5 text-mint" strokeWidth={2} />
      ) : (
        <Copy className="size-3.5" strokeWidth={1.9} />
      )}
      <span className="sr-only">{copied ? "Copied" : label}</span>
    </button>
  );
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-line bg-inset">
      <div className="flex items-center justify-between border-b border-line-soft px-3 py-1">
        <span className="mono-label">Code</span>
        <CopyButton getText={() => ref.current?.innerText ?? ""} label="Copy code" />
      </div>
      <pre ref={ref} className="scrollbar-thin overflow-x-auto px-3.5 py-3">
        {children}
      </pre>
    </div>
  );
}

export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("chat-prose", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // A block code element always arrives wrapped in `pre`; this gives it
          // a header with a working copy action.
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            <img
              src={typeof src === "string" ? src : undefined}
              alt={alt ?? ""}
              loading="lazy"
              className="max-h-80 rounded-lg border border-line"
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
