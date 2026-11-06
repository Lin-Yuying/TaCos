/** Regression checks for personal views/order, retained field values and full conversation history. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
process.env.TACOS_DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "tacos-personal-ui-"),
);
async function main() {
  const { getDb } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const db = getDb(),
    user = db.select().from(schema.users).get()!,
    ws = db.select().from(schema.workspaces).get()!;
  const other = db
    .select()
    .from(schema.users)
    .all()
    .find((row) => row.id !== user.id)!;
  const views = await import("../src/lib/task-views");
  const value = {
    filters: [{ key: "status", op: "is", value: "todo" }],
    sort: [{ key: "priority", dir: "desc" }],
    layout: "board",
  };
  views.savePersonalView(ws.id, user.id, "tasks", "Focus", value);
  assert.equal(
    views.listPersonalViews(ws.id, user.id, "tasks")[0].view.layout,
    "board",
  );
  assert.equal(views.listPersonalViews(ws.id, other.id, "tasks").length, 0);
  assert.equal(views.listPersonalViews(ws.id, user.id, "other-list").length, 0);
  assert.throws(() =>
    views.savePersonalView(ws.id, user.id, "tasks", "Bad", {
      ...value,
      layout: "broken",
    }),
  );
  views.deletePersonalView(ws.id, other.id, "tasks", "Focus");
  assert.equal(views.listPersonalViews(ws.id, user.id, "tasks").length, 1);
  const actor = {
    kind: "user" as const,
    userId: user.id,
    displayName: user.displayName,
  };
  const issues = await import("../src/lib/issues");
  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.workspaceId, ws.id))
    .get()!;
  const one = await issues.createIssue(
      ws.id,
      { project: project.key, title: "Personal first" },
      actor,
    ),
    two = await issues.createIssue(
      ws.id,
      { project: project.key, title: "Personal second" },
      actor,
    );
  const personal = await import("../src/lib/personal-entities");
  for (const task of [one, two])
    await personal.setPersonalPin(ws.id, user.id, "task", task.issue.id, true);
  await personal.reorderPersonalEntities(ws.id, user.id, "pin", [
    { kind: "task", id: two.issue.id },
    { kind: "task", id: one.issue.id },
  ]);
  assert.deepEqual(
    (await personal.listPersonalPins(ws.id, user.id)).map((row) => row.id),
    [two.issue.id, one.issue.id],
  );
  assert.equal((await personal.listPersonalPins(ws.id, other.id)).length, 0);
  const fields = await import("../src/lib/task-fields");
  const stage = await fields.createTaskField(ws.id, user.id, {
    name: "Phase",
    type: "select",
    options: ["old", "new"],
  });
  await fields.setTaskFieldValue(
    ws.id,
    one.issue.id,
    stage.id,
    "old",
    user.id,
    actor,
  );
  await fields.updateTaskField(ws.id, user.id, stage.id, {
    name: "Renamed phase",
    options: ["new"],
  });
  assert.equal(
    (await fields.listFieldValues([one.issue.id]))[one.issue.id][stage.id],
    "old",
  );
  await fields.deleteTaskField(ws.id, user.id, stage.id);
  assert.equal(
    (await fields.listFieldValues([one.issue.id]))[one.issue.id],
    undefined,
  );
  await fields.restoreTaskField(ws.id, user.id, stage.id);
  assert.equal(
    (await fields.listFieldValues([one.issue.id]))[one.issue.id][stage.id],
    "old",
  );
  const threads = await import("../src/lib/agent-threads");
  for (let i = 0; i < 220; i++)
    db.insert(schema.agentThreads)
      .values({
        id: `history-${i}`,
        workspaceId: ws.id,
        projectId: project.id,
        title: `History ${i}`,
        engine: "pi",
        visibility: "private",
        createdBy: user.id,
        createdAt: new Date(i * 1000).toISOString(),
        updatedAt: new Date(i * 1000).toISOString(),
      })
      .run();
  await threads.appendAgentMessage({
    threadId: "history-0",
    role: "user",
    content: "Unique old body needle",
    authorId: user.id,
  });
  // Keep this thread old after appending a message, so title/body search genuinely reaches beyond recents.
  db.update(schema.agentThreads)
    .set({ updatedAt: new Date(0).toISOString() })
    .where(eq(schema.agentThreads.id, "history-0"))
    .run();
  await threads.setAgentThreadPinned(ws.id, user.id, "history-0", true);
  assert(
    (await threads.listAgentThreads(ws.id, user.id)).some(
      (row) => row.id === "history-0",
    ),
  );
  assert.deepEqual(
    (
      await threads.searchAgentThreads(ws.id, user.id, "old body needle")
    ).threads.map((row) => row.id),
    ["history-0"],
  );
  assert.equal(
    (await threads.searchAgentThreads(ws.id, other.id, "old body needle"))
      .threads.length,
    0,
  );
  const found = new Set<string>();
  let offset: number | null = 0;
  while (offset !== null) {
    const page = await threads.searchAgentThreads(
      ws.id,
      user.id,
      "History",
      offset,
    );
    for (const row of page.threads) {
      assert(!found.has(row.id));
      found.add(row.id);
    }
    offset = page.nextOffset;
  }
  assert.equal(found.size, 220);
  await threads.deleteAgentThread(ws.id, user.id, "history-0");
  assert.equal(
    (await threads.searchAgentThreads(ws.id, user.id, "old body needle"))
      .threads.length,
    0,
  );
  console.log("check-ui-personalization: pass");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
