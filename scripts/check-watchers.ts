// U-11 follow/watchers: the old implicit creator/assignee audience migrates into the
// watcher set, auto-follow fires on create/assign/mention/comment, and comment notices
// respect Unfollow and mute while explicit mentions still arrive.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-watchers-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { and, eq } = await import("drizzle-orm");
  const { issueAssignees, issues, notifications, projects, users } = await import("../src/db/schema");
  const lib = (await import("../src/lib/issues")) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const watch = (await import("../src/lib/watchers")) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const people = await db.select().from(users).limit(2);
  const alex = people[0];
  const sam = people[1];
  assert(project && alex && sam, "seeded workspace with two members required");
  const ws = project.workspaceId;
  const actor = { kind: "user" as const, userId: alex.id, displayName: alex.displayName };
  const other = { kind: "user" as const, userId: sam.id, displayName: sam.displayName };

  // 1. Migration: a seeded task's creator and assignee are already watchers.
  const [seeded] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.workspaceId, ws), eq(issues.createdBy, alex.id)))
    .limit(1);
  assert(seeded, "seeded task required");
  const migrated = await watch.watchState(ws, alex.id, "issue", seeded.id);
  assert((migrated as { following: boolean }).following, "seeded creator follows after migration");
  const assignees = await db
    .select()
    .from(issueAssignees)
    .where(eq(issueAssignees.issueId, seeded.id));
  for (const assignee of assignees) {
    const state = (await watch.watchState(ws, assignee.userId, "issue", seeded.id)) as { following: boolean };
    assert(state.following, "seeded assignee follows after migration");
  }

  // 2. Create + assign auto-follow.
  const created = (await lib.createIssue(
    ws,
    { title: "Follow target", project: project.key, assigneeIds: [sam.id] },
    actor
  )) as { issue: { id: string } };
  const issueId = created.issue.id;
  assert(
    ((await watch.watchState(ws, alex.id, "issue", issueId)) as { following: boolean }).following,
    "creating follows"
  );
  assert(
    ((await watch.watchState(ws, sam.id, "issue", issueId)) as { following: boolean }).following,
    "assigning follows"
  );

  const notices = async (userId: string) =>
    db
      .select()
      .from(notifications)
      .where(and(eq(notifications.issueId, issueId), eq(notifications.userId, userId)));

  // 3. Watchers get comment notices; a non-watcher does not.
  await watch.unfollowScope(ws, sam.id, "issue", issueId);
  const beforeSam = (await notices(sam.id)).length;
  await lib.addComment(ws, issueId, "Alex writes", actor);
  assert((await notices(sam.id)).length === beforeSam, "an unfollowed member gets no comment notice");

  await watch.followScope(ws, sam.id, "issue", issueId, "manual");
  const beforeFollow = (await notices(sam.id)).length;
  await lib.addComment(ws, issueId, "Alex writes again", actor);
  assert((await notices(sam.id)).length === beforeFollow + 1, "following delivers the comment notice");

  // 4. Mute stops watcher notices; an explicit mention still arrives.
  await watch.setWatchMuted(ws, sam.id, "issue", issueId, true);
  const beforeMute = (await notices(sam.id)).length;
  await lib.addComment(ws, issueId, "Quiet please", actor);
  assert((await notices(sam.id)).length === beforeMute, "mute stops comment notices");
  await lib.addComment(ws, issueId, "@sam direct mention", actor);
  assert((await notices(sam.id)).length === beforeMute + 1, "a direct mention still arrives while muted");
  assert(
    ((await watch.watchState(ws, sam.id, "issue", issueId)) as { muted: boolean }).muted,
    "mute is visible on the watcher row"
  );
  await watch.setWatchMuted(ws, sam.id, "issue", issueId, false);

  // 5. Mention and comment auto-follow, and the watcher list names the reason.
  await watch.unfollowScope(ws, sam.id, "issue", issueId);
  await lib.addComment(ws, issueId, "@sam join us", actor);
  assert(
    ((await watch.watchState(ws, sam.id, "issue", issueId)) as { following: boolean }).following,
    "a mention follows the task"
  );
  await watch.unfollowScope(ws, sam.id, "issue", issueId);
  await lib.addComment(ws, issueId, "Sam replies", other);
  assert(
    ((await watch.watchState(ws, sam.id, "issue", issueId)) as { following: boolean }).following,
    "commenting follows the task"
  );
  const state = (await watch.watchState(ws, alex.id, "issue", issueId)) as {
    watchers: Array<{ id: string; source: string }>;
  };
  assert(state.watchers.length >= 2, "the watcher list includes both members");
  assert(state.watchers.some((row) => row.id === alex.id && row.source === "creator"), "watcher source is named");

  // 6. Self-actions never notify self.
  const beforeSelf = (await notices(alex.id)).length;
  await lib.addComment(ws, issueId, "Talking to myself", actor);
  assert((await notices(alex.id)).length === beforeSelf, "a member is never notified about their own comment");

  // 7. Projects and documents follow their creator and accept explicit follow.
  const projectRow = (await lib.createProject({ workspaceId: ws, name: "Follow Project", createdBy: alex.id })) as { id: string };
  assert(
    ((await watch.watchState(ws, alex.id, "project", projectRow.id)) as { following: boolean }).following,
    "a project creator follows the project"
  );
  await watch.followScope(ws, sam.id, "project", projectRow.id, "manual");
  const projectWatchers = (await watch.listWatchers(ws, "project", projectRow.id)) as Array<{ id: string }>;
  assert(projectWatchers.some((row) => row.id === sam.id), "explicit project follow appears in the list");
  await watch.unfollowScope(ws, sam.id, "project", projectRow.id);
  assert(
    ((await watch.watchState(ws, sam.id, "project", projectRow.id)) as { following: boolean }).following === false,
    "unfollow removes the watcher row"
  );

  console.log("check-watchers: pass");
}

main().catch((err) => {
  console.error("check-watchers: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
