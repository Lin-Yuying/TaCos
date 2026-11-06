/**
 * U-09 commit 1: shared workspace/project views, the personal-view migration, and
 * the owner/admin permission rules.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-views-shared-"));
process.env.TACOS_DATA_DIR = dir;
process.env.TACOS_SEED_DEMO = "0";

async function main() {
  const Database = (await import("better-sqlite3")).default;
  const legacy = new Database(path.join(dir, "tacos.db"));
  legacy.exec(`
    CREATE TABLE personal_task_views (
      workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, scope TEXT NOT NULL,
      name TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY(workspace_id, user_id, scope, name)
    );
    INSERT INTO personal_task_views VALUES
      ('ws-legacy', 'user-legacy', '/ws-legacy?view=active&assignee=', 'Legacy active',
       '{"filters":[{"key":"status","op":"is","value":"active"}],"sort":[],"layout":"board"}'),
      ('ws-legacy', 'user-legacy', '/ws-legacy/projects/proj-legacy?view=all&assignee=', 'Legacy project',
       '{"filters":[],"sort":[{"key":"priority","dir":"desc"}],"layout":"table"}');
  `);
  legacy.close();

  const { getDb } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const views = await import("../src/lib/task-views");
  const db = getDb();
  const now = new Date().toISOString();
  const user = "user-owner";
  const other = "user-member";
  const admin = "user-admin";
  const outsider = "user-outsider";
  const ws = "ws-1";
  const project = "proj-1";
  const otherProject = "proj-2";
  db.insert(schema.users).values([
    { id: user, username: "owner", displayName: "Owner", passwordHash: "x", role: "member", createdAt: now },
    { id: other, username: "member", displayName: "Member", passwordHash: "x", role: "member", createdAt: now },
    { id: admin, username: "admin2", displayName: "Admin", passwordHash: "x", role: "member", createdAt: now },
    { id: outsider, username: "outsider", displayName: "Outsider", passwordHash: "x", role: "member", createdAt: now },
  ]).run();
  db.insert(schema.workspaces).values({ id: ws, name: "Workspace", key: "WS", createdBy: user, createdAt: now }).run();
  db.insert(schema.workspaceMembers).values([
    { workspaceId: ws, userId: user, role: "admin", createdAt: now },
    { workspaceId: ws, userId: other, role: "member", createdAt: now },
    { workspaceId: ws, userId: admin, role: "admin", createdAt: now },
  ]).run();
  db.insert(schema.projects).values([
    { id: project, workspaceId: ws, name: "One", key: "ONE", createdBy: user, createdAt: now },
    { id: otherProject, workspaceId: ws, name: "Two", key: "TWO", createdBy: user, createdAt: now },
  ]).run();

  // --- migration ---
  const migrated = db.$client
    .prepare("SELECT * FROM task_views WHERE workspace_id = 'ws-legacy' ORDER BY name")
    .all() as Array<{
    owner_id: string;
    scope: string;
    project_id: string | null;
    definition: string;
    shared: number;
  }>;
  assert.equal(migrated.length, 2, "both legacy personal views migrate");
  assert.equal(migrated[0].owner_id, "user-legacy", "migration keeps the owner");
  assert.equal(migrated[0].shared, 0, "migrated views stay private");
  assert.equal(migrated[0].scope, "workspace");
  assert.equal(JSON.parse(migrated[0].definition).context, "/ws-legacy?view=active&assignee=", "migration keeps the URL context");
  assert.equal(JSON.parse(migrated[0].definition).layout, "board", "migration keeps the layout");
  assert.equal(migrated[1].scope, "project");
  assert.equal(migrated[1].project_id, "proj-legacy");
  const legacyRows = db.$client
    .prepare("SELECT COUNT(*) AS n FROM personal_task_views")
    .get() as { n: number };
  assert.equal(legacyRows.n, 2, "legacy rows are kept for audit/rollback");

  // A legacy view is listed for its own context only.
  const legacyContext = views.listPersonalViews("ws-legacy", "user-legacy", "/ws-legacy?view=active&assignee=");
  assert.equal(legacyContext.length, 1);
  assert.equal(legacyContext[0].name, "Legacy active");

  // --- personal visibility ---
  views.savePersonalView(ws, user, "/ws-1?view=all&assignee=", "Mine", {
    filters: [{ key: "status", op: "is", value: "todo" }],
    sort: [],
    layout: "list",
  });
  assert.equal(
    views.listTaskViews(ws, user, { scope: "workspace", context: "/ws-1?view=all&assignee=" }).filter((v) => !v.shared).length,
    1,
    "owner sees the personal view"
  );
  assert.equal(
    views.listTaskViews(ws, other, { scope: "workspace", context: "/ws-1?view=all&assignee=" }).filter((v) => !v.shared).length,
    0,
    "a personal view never leaks to another member"
  );

  // --- shared workspace view ---
  const shared = views.createTaskView(ws, user, {
    name: "This week",
    scope: "workspace",
    shared: true,
    definition: {
      filters: [{ key: "status", op: "is", value: "active" }],
      sort: [],
      layout: "board",
      display: { grouping: "assignee", ordering: "priority", subIssues: false, showEmptyGroups: true, properties: ["id", "priority"] },
    },
  });
  assert.equal(shared.shared, true);
  assert.equal(shared.canManage, true, "owner can manage");
  assert.equal(shared.canSetDefault, true, "owner can set default");
  const otherList = views.listTaskViews(ws, other, { scope: "workspace" });
  assert.ok(otherList.some((view) => view.id === shared.id), "another member sees the shared view");
  assert.equal(
    otherList.find((view) => view.id === shared.id)?.canManage,
    false,
    "a plain member cannot manage someone else's shared view"
  );
  assert.throws(
    () => views.updateTaskView(ws, other, shared.id, { name: "Hijacked" }),
    /owner or a workspace admin/,
    "a plain member cannot rename someone else's shared view"
  );
  assert.throws(
    () => views.setDefaultTaskView(ws, other, shared.id),
    /owner or a workspace admin/,
    "a plain member cannot set a shared default"
  );

  // The shared admin account can curate any shared view.
  const renamed = views.updateTaskView(ws, admin, shared.id, { name: "This week (curated)" });
  assert.equal(renamed.name, "This week (curated)");

  // --- defaults ---
  views.setDefaultTaskView(ws, user, shared.id);
  assert.equal(
    views.defaultTaskView(ws, other, "workspace")?.id,
    shared.id,
    "members open the shared default"
  );
  const second = views.createTaskView(ws, user, {
    name: "Everything",
    scope: "workspace",
    shared: true,
    definition: { filters: [], sort: [], layout: "list" },
  });
  views.setDefaultTaskView(ws, admin, second.id);
  assert.equal(views.defaultTaskView(ws, other, "workspace")?.id, second.id);
  const firstAfter = views.getTaskView(ws, user, shared.id);
  assert.equal(firstAfter.isDefault, false, "setting a new default clears the old one");
  views.clearDefaultTaskView(ws, user, second.id);
  assert.equal(views.defaultTaskView(ws, other, "workspace"), null, "a cleared default opens no view");

  // --- project views ---
  const projectView = views.createTaskView(ws, user, {
    name: "Project scoped",
    scope: "project",
    projectId: project,
    shared: true,
    definition: { filters: [], sort: [], layout: "table" },
  });
  assert.equal(projectView.scope, "project");
  assert.equal(projectView.projectId, project);
  assert.ok(
    views.listTaskViews(ws, other, { scope: "project", projectId: project }).some((view) => view.id === projectView.id),
    "project members see the project view"
  );
  assert.ok(
    !views.listTaskViews(ws, other, { scope: "project", projectId: otherProject }).some((view) => view.id === projectView.id),
    "another project does not see the view"
  );
  assert.ok(
    !views.listTaskViews(ws, other, { scope: "workspace", sharedOnly: true }).some((view) => view.id === projectView.id),
    "the workspace sidebar does not list a project view"
  );
  assert.throws(
    () => views.createTaskView(ws, user, {
      name: "Bad project",
      scope: "project",
      projectId: "missing",
      shared: true,
      definition: { filters: [], sort: [], layout: "list" },
    }),
    /Project not found/,
    "a project view needs a real project"
  );

  // --- project views follow the workspace's task-visibility switch ---
  db.update(schema.workspaces).set({ membersSeeAllTasks: 0 }).where(eq(schema.workspaces.id, ws)).run();
  assert.ok(
    !views.listTaskViews(ws, other, { scope: "project", projectId: project }).some((view) => view.id === projectView.id),
    "a member outside the project does not see its view"
  );
  assert.throws(
    () => views.getTaskView(ws, other, projectView.id),
    /View not found/,
    "opening the project view by id is refused"
  );
  assert.ok(
    views.listTaskViews(ws, user, { scope: "workspace" }).length > 0,
    "the owner still sees workspace views"
  );
  db.update(schema.workspaces).set({ membersSeeAllTasks: 1 }).where(eq(schema.workspaces.id, ws)).run();

  // --- favorite is per member ---
  views.setTaskViewFavorite(ws, other, shared.id, true);
  assert.equal(views.getTaskView(ws, other, shared.id).favorite, true);
  assert.equal(views.getTaskView(ws, user, shared.id).favorite, false, "a favorite is not shared");

  // --- personal display override does not change the shared definition ---
  const override = views.saveTaskViewDefinition(ws, other, shared.id, {
    filters: [{ key: "priority", op: "is", value: "1" }],
    sort: [],
    layout: "calendar",
    display: { grouping: "priority", ordering: "manual", subIssues: true, showEmptyGroups: false, properties: ["id"] },
  });
  assert.equal(override.definition.layout, "calendar", "the member gets their override");
  assert.equal(override.hasPersonalOverride, true);
  assert.equal(
    views.getTaskView(ws, user, shared.id).definition.layout,
    "board",
    "the owner still sees the shared layout"
  );
  views.resetTaskViewOverride(ws, other, shared.id);
  assert.equal(views.getTaskView(ws, other, shared.id).definition.layout, "board");

  // The owner saving the definition changes it for everyone and clears overrides.
  views.saveTaskViewDefinition(ws, user, shared.id, {
    filters: [],
    sort: [],
    layout: "table",
    display: { grouping: "project", ordering: "dueDate", subIssues: true, showEmptyGroups: false, properties: ["id", "dueDate"] },
  });
  assert.equal(views.getTaskView(ws, other, shared.id).definition.layout, "table");

  // --- duplicate, rename, delete ---
  const copy = views.duplicateTaskView(ws, other, shared.id, { context: "/ws-1?view=all&assignee=" });
  assert.equal(copy.shared, false, "a duplicate is private");
  assert.equal(copy.ownerId, other);
  assert.match(copy.name, /copy$/);
  views.updateTaskView(ws, other, copy.id, { name: "Member copy" });
  assert.equal(views.getTaskView(ws, other, copy.id).name, "Member copy");
  assert.throws(
    () => views.getTaskView(ws, user, copy.id),
    /View not found/,
    "another member's copy stays private"
  );
  const before = views.listTaskViews(ws, user, { scope: "workspace" }).length;
  views.deleteTaskView(ws, user, shared.id);
  assert.equal(views.listTaskViews(ws, user, { scope: "workspace" }).length, before - 1);
  assert.throws(() => views.getTaskView(ws, user, shared.id), /View not found/);

  // --- invalid input ---
  assert.throws(
    () => views.createTaskView(ws, user, {
      name: "",
      scope: "workspace",
      shared: true,
      definition: { filters: [], sort: [], layout: "list" },
    }),
    /Enter a view name/
  );
  assert.throws(
    () => views.createTaskView(ws, user, {
      name: "Broken",
      scope: "workspace",
      shared: true,
      definition: { filters: [], sort: [], layout: "broken" },
    }),
    /valid filters/
  );

  console.log("check-views-shared: pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
