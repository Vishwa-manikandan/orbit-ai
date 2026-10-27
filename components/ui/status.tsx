import { Badge } from "./badge";

const map: Record<
  string,
  { label: string; variant: "neutral" | "amber" | "success" | "danger" | "lilac" }
> = {
  running: { label: "Running", variant: "lilac" },
  completed: { label: "Completed", variant: "success" },
  succeeded: { label: "Succeeded", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
  cancelled: { label: "Stopped", variant: "neutral" },
  awaiting_approval: { label: "Awaiting approval", variant: "amber" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Declined", variant: "danger" },
  pending: { label: "Pending", variant: "amber" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = map[status] ?? { label: status, variant: "neutral" as const };
  return (
    <Badge variant={meta.variant} className={className}>
      {(status === "running" || status === "pending") && (
        <span className="size-1.5 animate-pulse-soft rounded-full bg-current" />
      )}
      {meta.label}
    </Badge>
  );
}

export function statusTextClass(status: string): string {
  switch (status) {
    case "succeeded":
    case "completed":
    case "approved":
      return "text-mint";
    case "failed":
    case "rejected":
      return "text-rose";
    case "cancelled":
      return "text-faint";
    case "awaiting_approval":
    case "pending":
      return "text-amber";
    case "running":
      return "text-lilac";
    default:
      return "text-muted";
  }
}
