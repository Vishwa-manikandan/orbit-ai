import {
  ArrowRight,
  Boxes,
  Database,
  Mail,
  CalendarDays,
  ShieldCheck,
  Terminal,
  Workflow,
} from "lucide-react";
import { toolCatalog } from "@/convex/lib/tools";
import { PageHeader } from "@/components/page-header";
import { ResetDemo } from "@/components/reset-demo";
import { RuntimeStatus } from "@/components/runtime-status";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { OrbitMark } from "@/components/orbit-mark";

const flow = [
  "User request enters the workspace",
  "Planner selects tools (model, or built-in patterns)",
  "Arguments validated with Zod",
  "Approval gate checked before execution",
  "Mock Gmail / Calendar adapter runs",
  "Tool results are fed back to the planner",
  "Planner answers, asks, or plans the next turn",
  "Convex persists state, results, audit",
  "Trace surfaces in the UI",
];

export default function SettingsPage() {
  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col lg:h-dvh">
      <PageHeader
        kicker="Configuration"
        title="Runtime & integrations"
        description="How Orbit plans, executes, and records work."
        actions={
          <Badge variant="amber">
            <span className="size-1.5 rounded-full bg-current" />
            Local demo
          </Badge>
        }
      />

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 lg:px-8">
          <div className="grid gap-4 md:grid-cols-2">
            <RuntimeStatus />

            <section className="rounded-xl border border-line bg-panel-2 p-4">
              <div className="flex items-center gap-2">
                <Database className="size-4 text-lilac" strokeWidth={1.7} />
                <h2 className="text-[13px] font-medium text-text">Persistence</h2>
                <Badge variant="success" className="ml-auto">
                  Convex
                </Badge>
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
                Convex stores conversations, runs, tool executions, approvals, drafts, tasks, and
                the append-only audit log. This workspace runs an anonymous local deployment, so no
                account is required.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {[
                  "threads",
                  "messages",
                  "agentRuns",
                  "executions",
                  "approvals",
                  "auditEvents",
                  "mailThreads",
                  "calendarEvents",
                  "drafts",
                  "tasks",
                ].map((table) => (
                  <span
                    key={table}
                    className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[9px] text-faint"
                  >
                    {table}
                  </span>
                ))}
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-[10px] text-faint">
                <Terminal className="size-3" />
                Start the backend with <code className="font-mono text-muted">npx convex dev</code>
              </p>
            </section>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-xl border border-line bg-panel-2 p-4">
              <div className="flex items-center gap-2">
                <Mail className="size-4 text-amber" strokeWidth={1.7} />
                <h2 className="text-[13px] font-medium text-text">Gmail</h2>
                <Badge variant="amber" className="ml-auto">
                  Mock adapter
                </Badge>
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
                Five seeded threads back search, summaries, drafts, and the approval-gated send.
                Sending appends to the mock thread and marks the draft terminal.
              </p>
              <p className="mt-2.5 font-mono text-[9px] tracking-wide text-faint">
                IMPLEMENTS WorkspacePort · SEND REQUIRES APPROVAL
              </p>
            </section>

            <section className="rounded-xl border border-line bg-panel-2 p-4">
              <div className="flex items-center gap-2">
                <CalendarDays className="size-4 text-mint" strokeWidth={1.7} />
                <h2 className="text-[13px] font-medium text-text">Google Calendar</h2>
                <Badge variant="amber" className="ml-auto">
                  Mock adapter
                </Badge>
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
                Seeded events drive upcoming-event queries, meeting prep briefs, and overlap
                detection. The mock fixtures include a deliberate conflict.
              </p>
              <p className="mt-2.5 font-mono text-[9px] tracking-wide text-faint">
                IMPLEMENTS WorkspacePort · READ ONLY
              </p>
            </section>
          </div>

          <section className="rounded-xl border border-line bg-panel-2">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              <Boxes className="size-4 text-fog" strokeWidth={1.7} />
              <h2 className="text-[13px] font-medium text-text">Typed tool registry</h2>
              <span className="font-mono text-[9px] text-faint">{toolCatalog.length} TOOLS</span>
              <Badge variant="lilac" className="ml-auto">
                Zod validated
              </Badge>
            </div>
            <div className="divide-y divide-line">
              {toolCatalog.map((tool) => (
                <div key={tool.name} className="flex items-start gap-3 px-4 py-2.5">
                  <span className="mt-0.5 rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[8.5px] tracking-wide text-faint">
                    {tool.category}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11.5px] font-medium text-fog">{tool.label}</span>
                      <span className="font-mono text-[8.5px] text-faint">{tool.name}</span>
                    </div>
                    <p className="mt-0.5 text-[10.5px] leading-relaxed text-faint">
                      {tool.description}
                    </p>
                  </div>
                  <Badge variant={tool.requiresApproval ? "amber" : "neutral"}>
                    {tool.requiresApproval ? "Approval" : "Auto"}
                  </Badge>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
            <section className="rounded-xl border border-line bg-panel-2 p-4">
              <div className="flex items-center gap-2">
                <Workflow className="size-4 text-lilac" strokeWidth={1.7} />
                <h2 className="text-[13px] font-medium text-text">Request lifecycle</h2>
              </div>
              <ol className="mt-3 space-y-2">
                {flow.map((step, index) => (
                  <li key={step} className="flex items-start gap-2.5">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded border border-line bg-panel-2 font-mono text-[8.5px] text-faint">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="pt-0.5 text-[11px] text-muted">{step}</span>
                    {index < flow.length - 1 && (
                      <ArrowRight className="mt-1 ml-auto size-3 shrink-0 text-faint/50" />
                    )}
                  </li>
                ))}
              </ol>
            </section>

            <section className="rounded-xl border border-line bg-panel-2 p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-mint" strokeWidth={1.7} />
                <h2 className="text-[13px] font-medium text-text">Security boundaries</h2>
              </div>
              <ul className="mt-2.5 space-y-2 text-[11px] leading-relaxed text-muted">
                <li>
                  • No sign-in yet; a browser session reaches only its own conversations, runs, and
                  approvals.
                </li>
                <li>• Tool inputs are validated before execution.</li>
                <li>• Sensitive tools pause for explicit human approval.</li>
                <li>• Sent drafts cannot be sent twice.</li>
                <li>• LLM credentials stay server-side in Convex env.</li>
                <li>• Every run produces an immutable audit trail.</li>
              </ul>
            </section>
          </div>

          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel-2 p-4">
            <div>
              <h2 className="text-[13px] font-medium text-text">Appearance</h2>
              <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted">
                Light or dark. Your choice is remembered on this device; until you pick one, Orbit
                follows your system setting.
              </p>
            </div>
            <ThemeToggle className="border border-line bg-panel" />
          </section>

          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel-2 p-4">
            <div>
              <h2 className="text-[13px] font-medium text-text">Demo data</h2>
              <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted">
                Restore the seeded Gmail threads, calendar events, follow-ups, and ready-to-send
                draft. This clears conversations, runs, approvals, and audit history in the local
                deployment.
              </p>
            </div>
            <ResetDemo />
          </section>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 pb-2">
            <div className="flex items-center gap-2">
              <OrbitMark className="size-5 opacity-70" />
              <span className="font-mono text-[9px] tracking-wide text-faint">
                ORBIT AI · TYPESCRIPT / NEXT.JS / CONVEX
              </span>
            </div>
            <span className="font-mono text-[9px] tracking-wide text-faint">
              LICENSE TBD · MOCK INTEGRATIONS
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}
