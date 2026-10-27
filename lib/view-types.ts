import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";

export type ThreadView = NonNullable<FunctionReturnType<typeof api.chat.getThread>>;
export type RunEntry = ThreadView["runs"][string];
export type ChatMessage = ThreadView["messages"][number];
export type ChatApproval = NonNullable<RunEntry["approval"]>;

export type ApprovalListItem = NonNullable<
  FunctionReturnType<typeof api.approvals.list>
>["pending"][number];

export type ActivityRun = NonNullable<
  FunctionReturnType<typeof api.activity.list>
>["runs"][number];

export type ActivityExecution = ActivityRun["executions"][number];
