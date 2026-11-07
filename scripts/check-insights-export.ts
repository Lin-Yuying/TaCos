/**
 * U-02: CSV export shape and access control, plus shared-report resolution.
 *
 * The export is generated from the same `InsightData.rows` the table renders. This
 * check proves the file follows RFC 4180 quoting, uses the workspace timezone for day
 * columns, and never includes a project the viewer cannot see — even when the URL
 * names that project explicitly.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-insights-export-"));
process.env.TACOS_SEED_DEMO = "0";

async function main() {
  const { getDb } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const insights = await import("../src/lib/insights");
  const views = await import("../src/lib/task-views");
  const { eq } = await import("drizzle-orm");

  const db = getDb();
  const now = new Date().toISOString();
  db.insert(schema.users)
    .values([
      { id: "owner", username: "owner", displayName: "Owner", passwordHash: "x", role: "member", createdAt: now },
      { id: "member", username: "member", displayName: "Member", passwordHash: "x", role: "member", createdAt: now },
    ])
    .run();
  db.insert(schema.workspaces)
    .values({
      id: "ws",
      name: "Workspace",
      key: "WS",
      createdBy: "owner",
      membersSeeAllTasks: 0,
      createdAt: now,
    })
    .run();
  db.insert(schema.workspaceMembers)
    .values([
      { workspaceId: "ws", userId: "owner", role: "admin", createdAt: now },
      { workspaceId: "ws", userId: "member", role: "member", createdAt: now },
    ])
    .run();
  db.insert(schema.projects)
    .values([
      { id: "p1", workspaceId: "ws", name: "Core", key: "CORE", createdBy: "owner", createdAt: now },
      { id: "p2", workspaceId: "ws", name: "Secret", key: "SECRET", createdBy: "owner", createdAt: now },
    ])
    .run();
  db.insert(schema.projectMembers)
    .values({ projectId: "p1", userId: "member", createdAt: now })
    .run();
  const issue = (partial: Record<string, unknown>) => ({
    workspaceId: "ws",
    priority: 0,
    createdVia: "web",
    position: 0,
    reviewStatus: "approved",
    createdAt: "2026-01-06T00:30:00.000Z",
    updatedAt: "2026-01-07T00:30:00.000Z",
    ...partial,
  });
  db.insert(schema.issues)
    .values([
      issue({
        id: "a1",
        identifier: "CORE-1",
        number: 1,
        projectId: "p1",
        title: 'Comma, "quoted"\nline',
        status: "done",
        createdAt: "2026-01-06T00:30:00.000Z",
        updatedAt: "2026-01-07T00:30:00.000Z",
        createdBy: "owner",
      }),
      issue({
        id: "b1",
        identifier: "SECRET-1",
        number: 1,
        projectId: "p2",
        title: "Hidden project task",
        status: "done",
        createdAt: "2026-01-05T09:00:00.000Z",
        updatedAt: "2026-01-06T09:00:00.000Z",
        createdBy: "owner",
      }),
    ] as (typeof schema.issues.$inferInsert)[])
    .run();
  db.insert(schema.issueAssignees)
    .values([
      { issueId: "a1", userId: "member", createdAt: now },
      { issueId: "b1", userId: "owner", createdAt: now },
    ])
    .run();
  db.insert(schema.events)
    .values([
      {
        id: "e1",
        issueId: "a1",
        type: "status_changed",
        data: JSON.stringify({ from: "todo", to: "in_progress" }),
        createdAt: "2026-01-06T01:00:00.000Z",
        workspaceId: "ws",
        objectType: "task",
        objectId: "a1",
        projectId: "p1",
        visibility: "project",
      },
      {
        id: "e2",
        issueId: "a1",
        type: "status_changed",
        data: JSON.stringify({ from: "in_progress", to: "done" }),
        createdAt: "2026-01-07T00:30:00.000Z",
        workspaceId: "ws",
        objectType: "task",
        objectId: "a1",
        projectId: "p1",
        visibility: "project",
      },
      {
        id: "e3",
        issueId: "b1",
        type: "status_changed",
        data: JSON.stringify({ from: "todo", to: "done" }),
        createdAt: "2026-01-06T09:00:00.000Z",
        workspaceId: "ws",
        objectType: "task",
        objectId: "b1",
        projectId: "p2",
        visibility: "project",
      },
    ])
    .run();

  const range = { from: "2026-01-05", to: "2026-01-10" };
  const ownerData = await insights.aggregateInsights("ws", "owner", range, {
    timeZone: "America/Los_Angeles",
    now: "2026-01-10T12:00:00.000Z",
  });
  assert.equal(ownerData.rows.length, 2, "the owner sees both projects");
  const memberData = await insights.aggregateInsights("ws", "member", range, {
    timeZone: "America/Los_Angeles",
    now: "2026-01-10T12:00:00.000Z",
  });
  assert.equal(memberData.rows.length, 1, "the member only sees the project they joined");
  assert.equal(memberData.rows[0].identifier, "CORE-1");
  assert.ok(
    !memberData.rows.some((row) => row.identifier === "SECRET-1"),
    "an invisible project never reaches the rows"
  );

  // An explicit URL filter for a project the viewer cannot see yields no report rows.
  const blocked = await insights.aggregateInsights(
    "ws",
    "member",
    { ...range, projectId: "p2" },
    { timeZone: "America/Los_Angeles", now: "2026-01-10T12:00:00.000Z" }
  );
  assert.equal(blocked.rows.length, 0, "a guessed project id cannot widen access");
  assert.equal(blocked.metrics.created, 0);
  assert.equal(blocked.metrics.completed, 0);

  // --- CSV shape ------------------------------------------------------------------
  const csv = insights.buildInsightsCsv(memberData);
  const header = csv.split("\r\n")[0];
  assert.equal(
    header,
    "identifier,title,status,project,assignees,created,completed,canceled,lead_days,cycle_days,delegated_agent,estimate",
    "stable column order"
  );
  assert.equal(csv.split("\r\n").length, 3, "header + one row + trailing CRLF");
  assert.ok(csv.includes('"Comma, ""quoted""\nline"'), "commas, quotes and newlines are escaped");
  assert.ok(csv.includes("CORE-1"));
  assert.ok(!csv.includes("SECRET-1"), "the CSV cannot leak the hidden project");
  assert.ok(csv.includes(",2026-01-05,"), "creation day follows the display timezone (00:30Z is Jan 5 in Los Angeles)");
  assert.ok(csv.includes(",2026-01-06,"), "completion day follows the display timezone");
  assert.equal(
    insights.insightExportName(memberData),
    "insights-2026-01-05-to-2026-01-10.csv"
  );
  assert.equal(
    insights.buildInsightsCsv(ownerData).includes("SECRET-1"),
    true,
    "the owner's export does include the other project"
  );

  // --- saved workspace report (U-09) ---------------------------------------------
  const config = {
    from: "2026-01-05",
    to: "2026-01-10",
    projectId: "p1",
    assigneeId: null,
    label: "",
    status: "all" as const,
  };
  const saved = views.createInsightView("ws", "owner", "Core report", config);
  assert.equal(saved.shared, true);
  assert.deepEqual(saved.definition.insight, config);
  assert.ok(
    views.listInsightViews("ws", "member").some((view) => view.id === saved.id),
    "every member sees the shared report"
  );
  assert.ok(
    views.listTaskViews("ws", "member", { scope: "workspace" }).every((view) => !view.definition.insight),
    "task lists do not show reports"
  );
  const resolved = await insights.resolveInsightRequest(
    "ws",
    "member",
    { viewId: saved.id },
    { timeZone: "America/Los_Angeles", now: "2026-01-10T12:00:00.000Z" }
  );
  assert.equal(resolved.viewId, saved.id);
  assert.equal(resolved.viewName, "Core report");
  assert.deepEqual(resolved.config, config);
  const savedData = await insights.aggregateInsights("ws", "member", resolved.config, {
    timeZone: resolved.timeZone,
    now: "2026-01-10T12:00:00.000Z",
  });
  assert.equal(savedData.rows.length, 1);
  assert.ok(!insights.buildInsightsCsv(savedData).includes("SECRET"));

  // A personal report is not a link another member can open.
  const personal = views.createTaskView("ws", "owner", {
    name: "Owner only",
    scope: "workspace",
    shared: false,
    definition: { filters: [], sort: [], layout: "list", insight: config },
  });
  const personalForOwner = await insights.resolveInsightRequest("ws", "owner", { viewId: personal.id });
  assert.equal(personalForOwner.viewId, null, "only shared reports are resolvable links");
  assert.ok(personalForOwner.notices.some((notice) => notice.kind === "view-unavailable"));
  const personalForMember = await insights.resolveInsightRequest("ws", "member", { viewId: personal.id });
  assert.equal(personalForMember.viewId, null);
  assert.ok(personalForMember.notices.some((notice) => notice.kind === "view-unavailable"));

  // Explicit URL params override the saved report (the page updates the URL).
  const overridden = await insights.resolveInsightRequest(
    "ws",
    "member",
    { viewId: saved.id, project: "p2" },
    { now: "2026-01-10T12:00:00.000Z" }
  );
  assert.equal(overridden.config.projectId, "p2", "explicit filters win over the saved view");

  // Archived / removed views degrade to a notice, not an error page.
  db.update(schema.taskViews).set({ workspaceId: "other" }).where(eq(schema.taskViews.id, saved.id)).run();
  const missing = await insights.resolveInsightRequest("ws", "member", { viewId: saved.id });
  assert.equal(missing.viewId, null);
  assert.ok(missing.notices.some((notice) => notice.kind === "view-unavailable"));

  console.log("check-insights-export: pass (CSV shape/quoting/timezone, project access, shared report links)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
