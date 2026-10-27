export type ToolMeta = {
  label: string;
  category: "email" | "calendar" | "tasks";
  requiresApproval: boolean;
};

export const toolMeta: Record<string, ToolMeta> = {
  "email.searchThreads": { label: "Search email", category: "email", requiresApproval: false },
  "email.summarizeThread": { label: "Summarize thread", category: "email", requiresApproval: false },
  "email.draftReply": { label: "Draft reply", category: "email", requiresApproval: false },
  "email.sendDraft": { label: "Send email", category: "email", requiresApproval: true },
  "calendar.listEvents": { label: "List calendar", category: "calendar", requiresApproval: false },
  "calendar.prepBrief": { label: "Prep brief", category: "calendar", requiresApproval: false },
  "calendar.findConflicts": { label: "Find conflicts", category: "calendar", requiresApproval: false },
  "tasks.createFollowUp": { label: "Create follow-up", category: "tasks", requiresApproval: false },
  "tasks.listOpen": { label: "List follow-ups", category: "tasks", requiresApproval: false },
};

export function toolLabel(name: string): string {
  return toolMeta[name]?.label ?? name;
}
