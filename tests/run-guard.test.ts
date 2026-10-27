import { describe, expect, it } from "vitest";
import {
  duplicateSubmission,
  duplicateSubmissionMessage,
  isActiveRun,
  isStaleRun,
  STALE_RUN_MS,
} from "@/convex/lib/runGuard";

const NOW = 1_800_000_000_000;

describe("duplicate submission guard", () => {
  it("rejects a second message while a run is still working", () => {
    const runs = [{ status: "running", createdAt: NOW - 1_000 }];
    expect(duplicateSubmission(runs, NOW)).toEqual({ status: "running" });
    expect(duplicateSubmissionMessage("running")).toMatch(/still working/i);
  });

  it("rejects a second message while an approval is pending", () => {
    const runs = [{ status: "running", createdAt: NOW - 5_000 }, { status: "awaiting_approval", createdAt: NOW - 1_000 }];
    // The newest active run decides the message the user sees.
    expect(duplicateSubmission([{ status: "awaiting_approval", createdAt: NOW - 1_000 }], NOW)).toEqual({
      status: "awaiting_approval",
    });
    expect(duplicateSubmissionMessage("awaiting_approval")).toMatch(/pending approval/i);
    expect(runs).toHaveLength(2);
  });

  it("allows a new message after the previous run finished", () => {
    const runs = [
      { status: "completed", createdAt: NOW - 30_000 },
      { status: "failed", createdAt: NOW - 20_000 },
      { status: "cancelled", createdAt: NOW - 10_000 },
    ];
    expect(duplicateSubmission(runs, NOW)).toBeNull();
  });

  it("does not let an interrupted run block the conversation forever", () => {
    const stale = { status: "running", createdAt: NOW - STALE_RUN_MS - 1 };
    expect(isStaleRun(stale, NOW)).toBe(true);
    expect(isActiveRun(stale, NOW)).toBe(false);
    expect(duplicateSubmission([stale], NOW)).toBeNull();

    const fresh = { status: "running", createdAt: NOW - STALE_RUN_MS + 1 };
    expect(isStaleRun(fresh, NOW)).toBe(false);
    expect(duplicateSubmission([fresh], NOW)).toEqual({ status: "running" });
  });

  it("never reaps a run that is waiting for a human decision", () => {
    const waiting = { status: "awaiting_approval", createdAt: NOW - STALE_RUN_MS * 4 };
    expect(isStaleRun(waiting, NOW)).toBe(false);
    expect(duplicateSubmission([waiting], NOW)).toEqual({ status: "awaiting_approval" });
  });
});
