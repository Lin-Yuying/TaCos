/**
 * U-09 commit 3: a subscribed shared view notifies on added and completed/canceled
 * tasks through the existing Inbox; self-triggered actions, mutes, unfollowed views
 * and disabled preferences never notify.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-views-subs-"));
process.env.TACOS_SEED_DEMO = "0";

async function main() {
  const { getDb } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const issues = await import("../src/lib/issues");
  const views = await import("../src/lib/task-views");
  const subscriptions = await import("../src/lib/task-view-subscriptions");
  const { eq, and } = await import("drizzle-orm");
  const db = getDb();
  const now = new Date().toISOString();
  const actor = { kind: "user" as const, userId: "user-actor", displayName: "Actor" };
  const watcher = "user-watcher";
  db.insert(schema.users).values([
    { id: actor.userId, username: "actor", displayName: "Actor", passwordHash: "x", role: "member", createdAt: now },
    { id: watcher, username: "watcher", displayName: "Watcher", passwordHash: "x", role: "member", createdAt: now },
  ]).run();
  db.insert(schema.workspaces).values({ id: "ws", name: "W", key: "W", createdBy: actor.userId, createdAt: now }).run();
  db.insert(schema.workspaceMembers).values([
    { workspaceId: "ws", userId: actor.userId, role: "admin", createdAt: now },
    { workspaceId: "ws", userId: watcher, role: "member", createdAt: now },
  ]).run();
  db.insert(schema.projects).values([
    { id: "p1", workspaceId: "ws", name: "One", key: "ONE", createdBy: actor.userId, createdAt: now },
    { id: "p2", workspaceId: "ws", name: "Two", key: "TWO", createdBy: actor.userId, createdAt: now },
  ]).run();

  const view = views.createTaskView("ws", actor.userId, {
    name: "Priority two",
    scope: "workspace",
    shared: true,
    definition: {
      filters: [{ key: "priority", op: "is", value: "2" }],
      sort: [],
      layout: "list",
    },
  });
  subscriptions.subscribeToTaskView("ws", watcher, view.id);
  subscriptions.subscribeToTaskView("ws", actor.userId, view.id);

  const notices = (type: string, issueId?: string) => {
    const conditions = [eq(schema.notifications.workspaceId, "ws"), eq(schema.notifications.type, type)];
    if (issueId) conditions.push(eq(schema.notifications.issueId, issueId));
    return db.select().from(schema.notifications).where(and(...conditions)).all();
  };

  async function create(title: string, priority: 0 | 1 | 2 | 3 | 4, project = "ONE", assigneeIds: string[] = []) {
    const detail = await issues.createIssue(
      "ws",
      { title, priority, project, assigneeIds },
      actor
    );
    return detail.issue;
  }

  // 1. A matching task notifies the watcher; the actor is never notified about itself.
  const t1 = await create("Matching", 2, "ONE", [actor.userId]);
  const added = notices("view_added", t1.id);
  assert.equal(added.length, 1, "the watcher gets one added notice");
  assert.equal(added[0].userId, watcher);
  assert.equal(added[0].state, "unread");
  assert.equal(JSON.parse(added[0].data ?? "{}").viewName, "Priority two");

  // 2. A task outside the filter does not notify.
  const t2 = await create("Not matching", 1);
  assert.equal(notices("view_added", t2.id).length, 0, "a non-matching task stays out of the view");

  // 3. Completing a matching task notifies the watcher, once.
  await issues.updateIssue("ws", t1.id, { status: "done" }, actor);
  const completed = notices("view_completed", t1.id);
  assert.equal(completed.length, 1, "done sends one completed notice");
  assert.equal(completed[0].userId, watcher);
  assert.equal(JSON.parse(completed[0].data ?? "{}").statusLabel, "Done");

  // 4. Canceled counts as completed too.
  const t3 = await create("Cancel me", 2, "ONE", [actor.userId]);
  await issues.updateIssue("ws", t3.id, { status: "canceled" }, actor);
  assert.equal(notices("view_completed", t3.id).length, 1);
  assert.equal(JSON.parse(notices("view_completed", t3.id)[0].data ?? "{}").statusLabel, "Canceled");

  // 5. The board's moveIssue path notifies as well.
  const t4 = await create("Drag me", 2, "ONE", [actor.userId]);
  await issues.moveIssue("ws", t4.id, { status: "done" }, actor);
  assert.equal(notices("view_completed", t4.id).length, 1, "a board drop to done notifies");

  // 6. A non-completing status change does not notify.
  const t5 = await create("Still open", 2, "ONE", [actor.userId]);
  await issues.updateIssue("ws", t5.id, { status: "in_progress" }, actor);
  assert.equal(notices("view_completed", t5.id).length, 0);

  // 7. Mute and unmute.
  subscriptions.updateTaskViewSubscription("ws", watcher, view.id, { muted: true });
  const t6 = await create("While muted", 2);
  assert.equal(notices("view_added", t6.id).length, 0, "a muted view sends nothing");
  subscriptions.updateTaskViewSubscription("ws", watcher, view.id, { muted: false });
  const t7 = await create("After unmute", 2);
  assert.equal(notices("view_added", t7.id).length, 1);

  // 8. Unsubscribe.
  subscriptions.unsubscribeFromTaskView("ws", watcher, view.id);
  const t8 = await create("After unsubscribe", 2);
  assert.equal(notices("view_added", t8.id).length, 0);
  assert.deepEqual(subscriptions.subscribedViewIds("ws", watcher), []);

  // 9. Only the "added" event.
  subscriptions.subscribeToTaskView("ws", watcher, view.id, ["added"]);
  const t9 = await create("Added only", 2, "ONE", [actor.userId]);
  await issues.updateIssue("ws", t9.id, { status: "done" }, actor);
  assert.equal(notices("view_added", t9.id).length, 1);
  assert.equal(notices("view_completed", t9.id).length, 0, "completed is off for this subscription");

  // 10. Project-scoped views only match their project.
  const projectView = views.createTaskView("ws", actor.userId, {
    name: "Project two",
    scope: "project",
    projectId: "p2",
    shared: true,
    definition: { filters: [], sort: [], layout: "list" },
  });
  subscriptions.subscribeToTaskView("ws", watcher, projectView.id, ["added"]);
  const otherProject = await create("Wrong project", 2, "ONE");
  assert.equal(notices("view_added", otherProject.id).length, 1, "only the priority view matches, not the project view");
  const rightProject = await create("Right project", 1, "TWO");
  assert.equal(notices("view_added", rightProject.id).length, 1);

  // 10b. A member outside the project stops receiving its view notices.
  subscriptions.unsubscribeFromTaskView("ws", watcher, view.id);
  db.update(schema.workspaces).set({ membersSeeAllTasks: 0 }).where(eq(schema.workspaces.id, "ws")).run();
  const hiddenProject = await create("Hidden project task", 1, "TWO");
  assert.equal(
    notices("view_added", hiddenProject.id).length,
    0,
    "a project view does not notify someone who cannot open the project"
  );
  // A workspace-scoped view must not leak a hidden project's task either.
  subscriptions.subscribeToTaskView("ws", watcher, view.id, ["added"]);
  const hiddenWorkspaceView = await create("Hidden workspace view task", 2, "TWO");
  assert.equal(
    notices("view_added", hiddenWorkspaceView.id).length,
    0,
    "a workspace view does not notify someone who cannot open the task's project"
  );
  subscriptions.unsubscribeFromTaskView("ws", watcher, view.id);
  assert.throws(
    () => subscriptions.subscribeToTaskView("ws", watcher, projectView.id, ["added"]),
    /View not found/,
    "subscribing to a project view you cannot open is refused"
  );
  db.update(schema.workspaces).set({ membersSeeAllTasks: 1 }).where(eq(schema.workspaces.id, "ws")).run();
  subscriptions.subscribeToTaskView("ws", watcher, view.id, ["added", "completed"]);

  // 11. The Inbox preference group can turn view notices off without unsubscribing.
  const t10 = await create("Pref off", 2);
  assert.equal(notices("view_added", t10.id).length, 1);
  issues.saveNotificationPrefs("ws", watcher, { views: false });
  const t11 = await create("Pref still off", 2);
  assert.equal(notices("view_added", t11.id).length, 0, "a disabled group suppresses delivery");
  issues.saveNotificationPrefs("ws", watcher, { views: true });
  const t12 = await create("Pref back on", 2);
  assert.equal(notices("view_added", t12.id).length, 1);

  // 12. A personal view is not subscribeable; the view must be shared.
  const personal = views.createTaskView("ws", watcher, {
    name: "My private list",
    scope: "workspace",
    definition: { filters: [], sort: [], layout: "list" },
    context: "/ws?view=all&assignee=",
  });
  assert.throws(
    () => subscriptions.subscribeToTaskView("ws", watcher, personal.id),
    /View not found/,
    "personal views cannot be subscribed"
  );

  console.log("check-views-subscriptions: pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
