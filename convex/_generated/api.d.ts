/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as agent from "../agent.js";
import type * as approvals from "../approvals.js";
import type * as chat from "../chat.js";
import type * as lib_agentLoop from "../lib/agentLoop.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_llmPlanner from "../lib/llmPlanner.js";
import type * as lib_llmProvider from "../lib/llmProvider.js";
import type * as lib_planner from "../lib/planner.js";
import type * as lib_policy from "../lib/policy.js";
import type * as lib_runGuard from "../lib/runGuard.js";
import type * as lib_stream from "../lib/stream.js";
import type * as lib_tools from "../lib/tools.js";
import type * as lib_types from "../lib/types.js";
import type * as messages from "../messages.js";
import type * as orchestrator from "../orchestrator.js";
import type * as ownership from "../ownership.js";
import type * as runtime from "../runtime.js";
import type * as seed from "../seed.js";
import type * as threads from "../threads.js";
import type * as workspace from "../workspace.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  agent: typeof agent;
  approvals: typeof approvals;
  chat: typeof chat;
  "lib/agentLoop": typeof lib_agentLoop;
  "lib/authz": typeof lib_authz;
  "lib/errors": typeof lib_errors;
  "lib/llmPlanner": typeof lib_llmPlanner;
  "lib/llmProvider": typeof lib_llmProvider;
  "lib/planner": typeof lib_planner;
  "lib/policy": typeof lib_policy;
  "lib/runGuard": typeof lib_runGuard;
  "lib/stream": typeof lib_stream;
  "lib/tools": typeof lib_tools;
  "lib/types": typeof lib_types;
  messages: typeof messages;
  orchestrator: typeof orchestrator;
  ownership: typeof ownership;
  runtime: typeof runtime;
  seed: typeof seed;
  threads: typeof threads;
  workspace: typeof workspace;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
