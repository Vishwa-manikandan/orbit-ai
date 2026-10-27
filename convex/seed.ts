import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { resolvePrincipal } from "./lib/authz";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SEED_KEY = "seed:v1";

const seedResult = v.object({ threadId: v.id("threads") });

/**
 * Idempotent demo seed. In a real deployment this is replaced by the user's
 * Gmail/Calendar sync; the rest of the app is unchanged.
 */
async function seedFixtures(ctx: MutationCtx): Promise<void> {
  const meta = await ctx.db
      .query("appMeta")
      .withIndex("by_key", (q) => q.eq("key", SEED_KEY))
      .first();

    if (!meta) {
      const now = Date.now();

      const sarah = await ctx.db.insert("mailThreads", {
        externalId: "mail_sarah_launch",
        from: "Sarah Chen",
        fromEmail: "sarah@northwindlabs.com",
        subject: "Q3 launch timeline",
        snippet:
          "Can you confirm the final timeline and send the launch deck by Thursday? The onboarding flow is the one piece I'm still nervous about.",
        unread: true,
        needsAttention: true,
        labels: ["Launch", "Northwind"],
        receivedAt: now - 2 * HOUR,
        messages: [
          {
            from: "Sarah Chen",
            sentAt: now - 2 * HOUR,
            body: "Hi Alex,\n\nCan you confirm the final timeline for the Q3 launch and send the launch deck by Thursday? The onboarding flow is the one piece I'm still nervous about — if that slips, we should talk about cutting scope.\n\nThanks,\nSarah",
          },
          {
            from: "Alex Rivera",
            sentAt: now - 26 * HOUR,
            body: "Hi Sarah,\n\nThe timeline is still on track. I'll pull together the deck and flag any risk on onboarding before Thursday.\n\nBest,\nAlex",
          },
        ],
      });

      const marcus = await ctx.db.insert("mailThreads", {
        externalId: "mail_marcus_pricing",
        from: "Marcus Webb",
        fromEmail: "marcus@northwindlabs.com",
        subject: "Pricing page copy — final pass",
        snippet:
          "I tightened the headline and the three plan descriptions. Could you give the copy one last read before I hand it to engineering?",
        unread: true,
        needsAttention: true,
        labels: ["Marketing"],
        receivedAt: now - 5 * HOUR,
        messages: [
          {
            from: "Marcus Webb",
            sentAt: now - 5 * HOUR,
            body: "Hey Alex,\n\nI tightened the headline and the three plan descriptions. Could you give the copy one last read before I hand it to engineering? The only open question is whether we call the middle tier 'Growth' or 'Scale'.\n\nMarcus",
          },
        ],
      });

      await ctx.db.insert("mailThreads", {
        externalId: "mail_priya_helio",
        from: "Priya Raman",
        fromEmail: "priya@northwindlabs.com",
        subject: "Customer call notes: Helio",
        snippet:
          "Great call today. They want SSO before renewal, and they're open to joining the design partner program.",
        unread: false,
        needsAttention: false,
        labels: ["Customers"],
        receivedAt: now - DAY,
        messages: [
          {
            from: "Priya Raman",
            sentAt: now - DAY,
            body: "Great call today. Helio wants SSO before renewal and they're open to joining the design partner program. I'll write up the notes, but wanted to get this on your radar for Q3 planning.\n\nPriya",
          },
        ],
      });

      await ctx.db.insert("mailThreads", {
        externalId: "mail_linear_digest",
        from: "Linear",
        fromEmail: "no-reply@linear.app",
        subject: "3 issues moved to Done in Orbit",
        snippet: "ORB-112, ORB-118, and ORB-121 were completed by the engineering team.",
        unread: false,
        needsAttention: false,
        labels: ["Updates"],
        receivedAt: now - DAY - 3 * HOUR,
        messages: [
          {
            from: "Linear",
            sentAt: now - DAY - 3 * HOUR,
            body: "3 issues moved to Done in Orbit: ORB-112, ORB-118, and ORB-121.",
          },
        ],
      });

      await ctx.db.insert("mailThreads", {
        externalId: "mail_daniel_contract",
        from: "Daniel Ortiz",
        fromEmail: "daniel@northwindlabs.com",
        subject: "Re: contract renewal",
        snippet:
          "Legal approved the redlines. We just need your signature on the final page before Friday.",
        unread: false,
        needsAttention: true,
        labels: ["Legal"],
        receivedAt: now - 2 * DAY,
        messages: [
          {
            from: "Daniel Ortiz",
            sentAt: now - 2 * DAY,
            body: "Legal approved the redlines. We just need your signature on the final page before Friday.\n\nDaniel",
          },
        ],
      });

      await ctx.db.insert("drafts", {
        mailThreadId: sarah,
        subject: "Re: Q3 launch timeline",
        body: "Hi Sarah,\n\nQuick update: we're still on track for Thursday. I'll send the launch deck tomorrow morning and call out the onboarding risks explicitly so we can decide on scope together.\n\nBest,\nAlex",
        status: "draft",
        createdAt: now - HOUR,
      });

      await ctx.db.insert("calendarEvents", {
        externalId: "event_design_review",
        title: "Design review — Orbit dashboard",
        start: now + 2 * HOUR,
        end: now + 2 * HOUR + 45 * 60 * 1000,
        location: "Zoom",
        attendees: [
          { name: "Sarah Chen", email: "sarah@northwindlabs.com" },
          { name: "Marcus Webb", email: "marcus@northwindlabs.com" },
          { name: "Alex Rivera", email: "alex@northwindlabs.com" },
        ],
        description:
          "Final walkthrough of the agent workspace before the launch cut. Decision needed on the approvals panel density.",
        agenda: [
          "Walk through the dashboard and activity trace",
          "Decide on approvals panel density",
          "Confirm launch-week owners",
        ],
      });

      await ctx.db.insert("calendarEvents", {
        externalId: "event_priya_1on1",
        title: "1:1 with Priya",
        start: now + 26 * HOUR,
        end: now + 26 * HOUR + 30 * 60 * 1000,
        location: "Meet",
        attendees: [
          { name: "Priya Raman", email: "priya@northwindlabs.com" },
          { name: "Alex Rivera", email: "alex@northwindlabs.com" },
        ],
        description: "Weekly one-on-one. Follow up on Helio and the design partner program.",
        agenda: ["Helio follow-up", "Q3 design partner plan", "Growth check-in"],
      });

      await ctx.db.insert("calendarEvents", {
        externalId: "event_q3_planning",
        title: "Q3 launch planning",
        start: now + 2 * DAY,
        end: now + 2 * DAY + HOUR,
        location: "Board room",
        attendees: [
          { name: "Sarah Chen", email: "sarah@northwindlabs.com" },
          { name: "Marcus Webb", email: "marcus@northwindlabs.com" },
          { name: "Priya Raman", email: "priya@northwindlabs.com" },
        ],
        description: "Lock the launch scope, confirm the rollout sequence, and assign owners.",
      });

      await ctx.db.insert("calendarEvents", {
        externalId: "event_deep_work",
        title: "Deep work — roadmap",
        start: now + 2 * DAY,
        end: now + 2 * DAY + 2 * HOUR,
        location: "Focus block",
        attendees: [{ name: "Alex Rivera", email: "alex@northwindlabs.com" }],
        description: "Protected focus time for the Q4 roadmap draft.",
      });

      await ctx.db.insert("calendarEvents", {
        externalId: "event_helio_call",
        title: "Customer call — Helio",
        start: now + 3 * DAY,
        end: now + 3 * DAY + 30 * 60 * 1000,
        location: "Zoom",
        attendees: [
          { name: "Priya Raman", email: "priya@northwindlabs.com" },
          { name: "Dana Whitfield", email: "dana@helio.example" },
        ],
        description: "Renewal conversation. SSO timeline is the key dependency.",
        agenda: ["Renewal status", "SSO timeline", "Design partner follow-up"],
      });

      await ctx.db.insert("tasks", {
        title: "Send launch deck to Sarah",
        status: "open",
        dueAt: now + DAY,
        source: "Q3 launch timeline",
        createdAt: now - 3 * HOUR,
      });
      await ctx.db.insert("tasks", {
        title: "Review pricing page copy",
        status: "open",
        dueAt: now + 2 * DAY,
        source: "Pricing page copy — final pass",
        createdAt: now - 4 * HOUR,
      });

      await ctx.db.insert("auditEvents", {
        actor: "system",
        action: "integration.connected",
        subject: "Mock Gmail mailbox",
        detail: "5 threads imported from the local fixture set.",
        createdAt: now - 6 * HOUR,
      });
      await ctx.db.insert("auditEvents", {
        actor: "system",
        action: "integration.connected",
        subject: "Mock Google Calendar",
        detail: "5 events imported from the local fixture set.",
        createdAt: now - 6 * HOUR,
      });

      await ctx.db.insert("appMeta", { key: SEED_KEY, seededAt: now });
    }
}

async function createWelcomeThread(
  ctx: MutationCtx,
  ownerId: string,
): Promise<Id<"threads">> {
  const now = Date.now();
  const threadId = await ctx.db.insert("threads", {
    title: "Welcome to Orbit",
    ownerId,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("messages", {
    threadId,
    role: "assistant",
    content:
      "Workspace ready. I'm connected to a mock Gmail inbox and Google Calendar, and every action I take is traced.\n\nAsk me what needs attention, prepare you for your next meeting, or send the draft waiting in your outbox. Anything outbound will pause for your approval.",
    createdAt: now,
  });
  return threadId;
}

/** Rows from before ownership existed are adopted by the first session. */
async function claimUnownedThreads(ctx: MutationCtx, ownerId: string): Promise<void> {
  const threads = await ctx.db.query("threads").collect();
  for (const thread of threads) {
    if (!thread.ownerId) await ctx.db.patch(thread._id, { ownerId });
  }
}

export const ensureSeeded = mutation({
  args: { sessionId: v.string() },
  returns: seedResult,
  handler: async (ctx, { sessionId }) => {
    const principal = resolvePrincipal(sessionId);
    await seedFixtures(ctx);
    await claimUnownedThreads(ctx, principal.sessionId);

    const existing = await ctx.db
      .query("threads")
      .withIndex("by_owner", (q) => q.eq("ownerId", principal.sessionId))
      .order("desc")
      .first();
    if (existing) return { threadId: existing._id };
    return { threadId: await createWelcomeThread(ctx, principal.sessionId) };
  },
});

export const resetDemo = mutation({
  args: { sessionId: v.string() },
  returns: seedResult,
  handler: async (ctx, { sessionId }) => {
    const principal = resolvePrincipal(sessionId);
    for (const doc of await ctx.db.query("executions").collect()) await ctx.db.delete(doc._id);
    for (const doc of await ctx.db.query("approvals").collect()) await ctx.db.delete(doc._id);
    for (const doc of await ctx.db.query("agentRuns").collect()) await ctx.db.delete(doc._id);
    for (const doc of await ctx.db.query("messages").collect()) await ctx.db.delete(doc._id);
    for (const doc of await ctx.db.query("auditEvents").collect()) await ctx.db.delete(doc._id);
    for (const doc of await ctx.db.query("drafts").collect()) await ctx.db.delete(doc._id);
    for (const doc of await ctx.db.query("mailThreads").collect()) await ctx.db.delete(doc._id);
    for (const doc of await ctx.db.query("calendarEvents").collect()) await ctx.db.delete(doc._id);
    for (const doc of await ctx.db.query("tasks").collect()) await ctx.db.delete(doc._id);
    for (const doc of await ctx.db.query("threads").collect()) await ctx.db.delete(doc._id);
    for (const doc of await ctx.db.query("appMeta").collect()) await ctx.db.delete(doc._id);
    await seedFixtures(ctx);
    return { threadId: await createWelcomeThread(ctx, principal.sessionId) };
  },
});
