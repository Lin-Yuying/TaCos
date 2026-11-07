// Inbox triage data layer: tabs, Done/search, snooze, soft delete + undo, mutes,
// preferences, pagination and the 90-day retention sweep.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-inbox-triage-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { eq } = await import("drizzle-orm");
  const { getDb } = await import("../src/db/client");
  const { issues, notifications, workspaceMembers } = await import("../src/db/schema");
  const {
    addNotificationMute,
    clearNotifications,
    deleteNotification,
    listNotificationPage,
    markNotificationRead,
    markNotificationUnread,
    notificationCounts,
    notify,
    purgeOldNotifications,
    removeNotificationMute,
    restoreNotifications,
    saveNotificationPrefs,
    setNotificationState,
    snoozeNotification,
  } = await import("../src/lib/issues");

  const db = getDb();
  const [issue] = await db.select().from(issues).limit(1);
  assert(issue, "seed data needs a task");
  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, issue.workspaceId))
    .limit(1);
  assert(member, "seed data needs a member");
  const workspaceId = issue.workspaceId;
  const userId = member.userId;
  const now = new Date();
  const iso = (offsetMs = 0) => new Date(now.getTime() + offsetMs).toISOString();
  const insert = async (input: {
    id?: string;
    type: string;
    data?: Record<string, string>;
    state?: string;
    createdAt?: string;
    snoozedUntil?: string | null;
    body?: string;
    issueId?: string;
  }) => {
    const id = input.id ?? crypto.randomUUID();
    await db.insert(notifications).values({
      id,
      workspaceId,
      userId,
      issueId: input.issueId ?? issue.id,
      type: input.type,
      body: input.body ?? "",
      data: input.data ? JSON.stringify(input.data) : null,
      state: input.state ?? "unread",
      snoozedUntil: input.snoozedUntil ?? null,
      deletedAt: null,
      createdAt: input.createdAt ?? iso(),
    });
    return id;
  };

  const baseline = await notificationCounts(workspaceId, userId);
  const assignedUnread = await insert({
    type: "assigned",
    data: { actorName: "Sam", title: issue.title },
  });
  const mentionedUnread = await insert({
    type: "mentioned",
    data: { actorName: "Ada" },
    createdAt: iso(-1000),
  });
  const commentedRead = await insert({
    type: "commented",
    state: "read",
    data: { actorName: "Lin", title: issue.title },
    createdAt: iso(-2000),
  });
  const doneAssigned = await insert({
    type: "assigned",
    state: "done",
    data: { actorName: "Sam", title: "Done task" },
    createdAt: iso(-3000),
  });
  const workspaceDeleted = await insert({
    type: "workspace_deleted",
    issueId: "",
    data: { ownerName: "The owner", workspaceName: "Ops" },
    createdAt: iso(-4000),
  });
  const snoozed = await insert({
    type: "assigned",
    data: { actorName: "Sam", title: issue.title },
    snoozedUntil: iso(86_400_000),
    createdAt: iso(-5000),
  });
  const reviewDecision = await insert({
    type: "review_decision",
    data: { actorName: "Ada", title: "Review me", decision: "reject" },
    createdAt: iso(-6000),
  });

  const ids = async (options: Parameters<typeof listNotificationPage>[2] = {}) =>
    new Set((await listNotificationPage(workspaceId, userId, options)).rows.map((row) => row.id));

  const unreadIds = await ids({ tab: "unread" });
  assert(unreadIds.has(assignedUnread) && unreadIds.has(mentionedUnread) && unreadIds.has(workspaceDeleted), "unread tab must include unread notices");
  assert(!unreadIds.has(commentedRead) && !unreadIds.has(doneAssigned) && !unreadIds.has(snoozed), "unread tab must exclude read, done and snoozed rows");

  const mentionIds = await ids({ tab: "mentions" });
  assert(mentionIds.has(mentionedUnread) && !mentionIds.has(assignedUnread), "mentions tab must only show mentions");
  const assignedIds = await ids({ tab: "assigned" });
  assert(assignedIds.has(assignedUnread) && !assignedIds.has(doneAssigned), "assigned tab must exclude done rows");
  const reviewIds = await ids({ tab: "reviews" });
  assert(reviewIds.has(reviewDecision), "reviews tab must include the review decision");
  assert(!reviewIds.has(assignedUnread) && !reviewIds.has(mentionedUnread), "reviews tab must not fall back to unread");
  const allIds = await ids({ tab: "all" });
  assert(allIds.has(commentedRead) && allIds.has(assignedUnread), "all tab must include read rows");
  assert(!allIds.has(doneAssigned) && !allIds.has(snoozed), "all tab must exclude done and snoozed rows");

  const search = await listNotificationPage(workspaceId, userId, { q: "Done task" });
  assert(search.rows.some((row) => row.id === doneAssigned), "search must include Done rows");
  const counts = await notificationCounts(workspaceId, userId);
  assert(counts.unread >= baseline.unread + 3, "unread count must include the three visible unread rows");
  assert(counts.all >= baseline.all + 4, "all count must include read rows but not done/snoozed");
  assert(counts.reviews >= 1, "reviews count must report the review decision");

  await markNotificationRead(workspaceId, userId, assignedUnread);
  assert(!(await ids({ tab: "unread" })).has(assignedUnread), "mark read must leave unread");
  await markNotificationUnread(userId, assignedUnread);
  assert((await ids({ tab: "unread" })).has(assignedUnread), "mark unread must return to unread");

  await snoozeNotification(userId, assignedUnread, iso(3600_000));
  assert(!(await ids({ tab: "all" })).has(assignedUnread), "snoozed row must be hidden");
  await snoozeNotification(userId, assignedUnread, null);
  assert((await ids({ tab: "all" })).has(assignedUnread), "clearing snooze must show the row");

  await setNotificationState(userId, assignedUnread, "done");
  assert(!(await ids({ tab: "all" })).has(assignedUnread), "done row must leave the tabs");
  assert((await listNotificationPage(workspaceId, userId, { q: issue.title })).rows.some((row) => row.id === assignedUnread), "done row must stay searchable");
  await setNotificationState(userId, assignedUnread, "read");

  await deleteNotification(userId, mentionedUnread);
  assert(!(await ids({ tab: "all" })).has(mentionedUnread), "soft delete must hide the row");
  await restoreNotifications(userId, [mentionedUnread]);
  assert((await ids({ tab: "all" })).has(mentionedUnread), "undo restore must bring the row back");

  await clearNotifications(workspaceId, userId);
  assert((await ids({ tab: "all" })).size === 0, "clear all must hide every visible row");
  await restoreNotifications(userId, [mentionedUnread, assignedUnread, commentedRead]);
  assert((await ids({ tab: "all" })).has(mentionedUnread), "restoring a clear-all batch must work");

  await saveNotificationPrefs(workspaceId, userId, { mentions: false });
  const beforePref = (await listNotificationPage(workspaceId, userId, { tab: "mentions", limit: 100 })).rows.length;
  await notify({ workspaceId, userId, issueId: issue.id, type: "mentioned", body: "X", data: { actorName: "X" } });
  const afterPref = (await listNotificationPage(workspaceId, userId, { tab: "mentions", limit: 100 })).rows.length;
  assert(afterPref === beforePref, "disabled mention preference must suppress the notice");
  await notify({ workspaceId, userId, issueId: issue.id, type: "assigned", body: "", data: { actorName: "X", title: "T" } });
  assert((await ids({ tab: "assigned" })).size > assignedIds.size, "other event types must still arrive");
  await saveNotificationPrefs(workspaceId, userId, {});

  await addNotificationMute(workspaceId, userId, "issue", issue.id, issue.identifier);
  await notify({ workspaceId, userId, issueId: issue.id, type: "assigned", body: "", data: { actorName: "Y", title: "T" } });
  const afterMute = await db.select().from(notifications).where(eq(notifications.userId, userId));
  assert(!afterMute.some((row) => row.type === "assigned" && row.data?.includes('"Y"')), "muted task must suppress its notices");
  await removeNotificationMute(workspaceId, userId, "issue", issue.id);
  await notify({ workspaceId, userId, issueId: issue.id, type: "assigned", body: "", data: { actorName: "Z", title: "T" } });
  const afterUnmute = await db.select().from(notifications).where(eq(notifications.userId, userId));
  assert(afterUnmute.some((row) => row.type === "assigned" && row.data?.includes('"Z"')), "unmuting must let notices through");

  const old = await insert({ type: "commented", createdAt: new Date(Date.now() - 91 * 86_400_000).toISOString() });
  await purgeOldNotifications(true);
  const oldRow = await db.select().from(notifications).where(eq(notifications.id, old));
  assert(oldRow.length === 0, "notifications older than 90 days must be swept");

  const page1 = await listNotificationPage(workspaceId, userId, { tab: "all", limit: 2 });
  assert(page1.rows.length === 2 && page1.nextCursor, "pagination must return a cursor");
  const page2 = await listNotificationPage(workspaceId, userId, { tab: "all", limit: 2, cursor: page1.nextCursor });
  assert(page2.rows.length > 0 && !page2.rows.some((row) => page1.rows.some((first) => first.id === row.id)), "the next page must not repeat rows");

  console.log("check-inbox-triage: pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
