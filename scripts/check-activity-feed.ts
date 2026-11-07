// U-11 workspace activity: one permission-aware feed over tasks, documents and
// projects, with All / My / Following scopes, object/project/person filters and keyset
// pagination.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-activity-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { eq } = await import("drizzle-orm");
  const { projects, users, workspaces } = await import("../src/db/schema");
  const lib = (await import("../src/lib/issues")) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const pagesLib = (await import("../src/lib/pages")) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const watch = (await import("../src/lib/watchers")) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const activity = (await import("../src/lib/activity")) as unknown as {
    listWorkspaceActivity: (
      workspaceId: string,
      viewerId: string,
      query?: Record<string, unknown>
    ) => Promise<{
      items: Array<{
        id: string;
        type: string;
        objectType: string;
        objectId: string;
        title: string;
        identifier: string | null;
        projectId: string | null;
        projectName: string | null;
        actor: { id: string } | null;
        createdAt: string;
      }>;
      nextCursor: string | null;
    }>;
  };
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const people = await db.select().from(users).limit(2);
  const alex = people[0];
  const sam = people[1];
  assert(project && alex && sam, "seeded workspace with two members required");
  const ws = project.workspaceId;
  const actor = { kind: "user" as const, userId: alex.id, displayName: alex.displayName };
  const other = { kind: "user" as const, userId: sam.id, displayName: sam.displayName };

  // 1. Seeded history is already in the feed.
  const seeded = await activity.listWorkspaceActivity(ws, alex.id, { limit: 50 });
  assert(seeded.items.length > 0, "seeded task history appears in Activity");
  assert(
    seeded.items.every((item) => item.objectType === "task" && item.title && item.identifier),
    "task activity carries its object title and identifier"
  );

  // 2. New task changes appear chronologically, newest first.
  const created = (await lib.createIssue(
    ws,
    { title: "Activity target", project: project.key, assigneeIds: [sam.id] },
    actor
  )) as { issue: { id: string; identifier: string } };
  const issueId = created.issue.id;
  await lib.updateIssue(ws, issueId, { status: "in_progress" }, other);
  await lib.addComment(ws, issueId, "Activity comment", actor);
  const feed = await activity.listWorkspaceActivity(ws, alex.id, { limit: 50 });
  const mineTask = feed.items.filter((item) => item.objectId === issueId);
  assert(mineTask.length >= 3, "create, status and comment each add activity");
  assert(mineTask[0].createdAt >= mineTask[1].createdAt, "activity is newest first");
  assert(mineTask.some((item) => item.type === "status_changed"), "status change is activity");
  assert(mineTask.some((item) => item.type === "commented"), "comment is activity");

  // 3. Filters: My, person, object type, project.
  const my = await activity.listWorkspaceActivity(ws, alex.id, { scope: "mine", limit: 50 });
  assert(my.items.every((item) => item.actor?.id === alex.id), "My activity is only the viewer's actions");
  const byPerson = await activity.listWorkspaceActivity(ws, alex.id, { personId: sam.id, limit: 50 });
  assert(byPerson.items.length > 0 && byPerson.items.every((item) => item.actor?.id === sam.id), "person filter");
  const tasksOnly = await activity.listWorkspaceActivity(ws, alex.id, { objectType: "task", limit: 50 });
  assert(tasksOnly.items.every((item) => item.objectType === "task"), "object type filter");
  const projectOnly = await activity.listWorkspaceActivity(ws, alex.id, { projectId: project.id, limit: 50 });
  assert(projectOnly.items.length > 0 && projectOnly.items.every((item) => item.projectId === project.id), "project filter");

  // 4. Following scope: watched task and project appear; unfollowed object does not.
  await watch.followScope(ws, sam.id, "issue", issueId, "manual");
  const following = await activity.listWorkspaceActivity(ws, sam.id, { scope: "following", limit: 50 });
  assert(following.items.some((item) => item.objectId === issueId), "following scope includes the watched task");
  await watch.unfollowScope(ws, sam.id, "issue", issueId);
  const unfollowed = await activity.listWorkspaceActivity(ws, sam.id, { scope: "following", limit: 50 });
  assert(!unfollowed.items.some((item) => item.objectId === issueId), "unfollowed task leaves Following");

  // 5. Documents: private creation stays out of another member's feed; sharing adds it.
  const page = (await pagesLib.createPage(ws, alex.id, { title: "Private activity page" })) as { id: string };
  const afterCreate = await activity.listWorkspaceActivity(ws, sam.id, { limit: 50 });
  assert(!afterCreate.items.some((item) => item.objectId === page.id), "a private page is not in Activity for others");
  await pagesLib.setPageShared(ws, page.id, alex.id, true);
  const afterShare = await activity.listWorkspaceActivity(ws, sam.id, { limit: 50 });
  assert(afterShare.items.some((item) => item.objectId === page.id && item.type === "page_shared"), "a shared page appears");
  const pageComments = (await import("../src/lib/page-comments")) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  await pageComments.addPageComment(ws, page.id, sam.id, { body: "Document activity" });
  const afterPageComment = await activity.listWorkspaceActivity(ws, alex.id, { limit: 50 });
  assert(
    afterPageComment.items.some((item) => item.objectId === page.id && item.type === "page_commented"),
    "document comments appear in Activity"
  );

  // 6. Permission: with workspace-wide task visibility off, a project outsider sees
  // neither the project's activity nor its tasks. Project and document filters comply.
  await db.update(workspaces).set({ membersSeeAllTasks: 0 }).where(eq(workspaces.id, ws));
  const privateProject = (await lib.createProject({
    workspaceId: ws,
    name: "Restricted activity project",
    createdBy: alex.id,
  })) as { id: string };
  const privateTask = (await lib.createIssue(
    ws,
    { title: "Restricted activity task", project: privateProject.id },
    actor
  )) as { issue: { id: string } };
  const outsider = await activity.listWorkspaceActivity(ws, sam.id, { limit: 100 });
  assert(
    !outsider.items.some((item) => item.objectId === privateProject.id || item.objectId === privateTask.issue.id),
    "a project outsider must not see its activity"
  );
  const insider = await activity.listWorkspaceActivity(ws, alex.id, { limit: 100 });
  assert(
    insider.items.some((item) => item.objectId === privateProject.id),
    "the project creator still sees its activity"
  );
  await db.update(workspaces).set({ membersSeeAllTasks: 1 }).where(eq(workspaces.id, ws));

  // 7. Keyset pagination: small pages resume without duplicates or gaps.
  for (let index = 0; index < 5; index += 1) {
    await lib.addComment(ws, issueId, `Paging ${index}`, actor);
  }
  const seen: string[] = [];
  let cursor: string | null = null;
  let pagesRead = 0;
  let lastAt = "9999";
  do {
    const pageResult = await activity.listWorkspaceActivity(ws, alex.id, { limit: 3, cursor });
    if (pageResult.items.length === 0) break;
    for (const item of pageResult.items) {
      assert(!seen.includes(item.id), "pagination must not repeat an event");
      seen.push(item.id);
      assert(item.createdAt <= lastAt, "pagination stays chronological");
      lastAt = item.createdAt;
    }
    cursor = pageResult.nextCursor;
    pagesRead += 1;
    if (pagesRead > 40) break;
  } while (cursor);
  assert(pagesRead > 1, "pagination reads more than one page");
  const onePage = await activity.listWorkspaceActivity(ws, alex.id, { limit: 50 });
  assert(
    onePage.items.every((item, index) => seen[index] === item.id),
    "paginated activity matches the single-page order without gaps or repeats"
  );
  assert(seen.length >= 8, "pagination returns the full recent feed");

  console.log("check-activity-feed: pass");
}

main().catch((err) => {
  console.error("check-activity-feed: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
