// Structured notification payloads: legacy English bodies parse into data, new rows
// return parsed data from the inbox query, and the UI renders from data not body.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-inbox-payload-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { parseLegacyNotificationBody, parseNotificationData } = await import("../src/lib/notification-data");
  const assigned = parseLegacyNotificationBody("assigned", "Sam assigned you to “Fix login”");
  assert(assigned?.actorName === "Sam" && assigned.title === "Fix login", "assigned legacy body must parse");
  const commented = parseLegacyNotificationBody("commented", "Ada commented on “Ship it”");
  assert(commented?.actorName === "Ada" && commented.title === "Ship it", "commented legacy body must parse");
  const deleted = parseLegacyNotificationBody("workspace_deleted", 'The owner deleted the workspace "Ops".');
  assert(deleted?.ownerName === "The owner" && deleted.workspaceName === "Ops", "workspace deletion must parse");
  assert(parseLegacyNotificationBody("mentioned", "Lin")?.actorName === "Lin", "actor-only notices must parse");
  assert(parseLegacyNotificationBody("due_soon", "2026-11-06")?.date === "2026-11-06", "due notice must parse");
  assert(parseLegacyNotificationBody("handoff_done", "CORE-7")?.task === "CORE-7", "handoff notice must parse");
  assert(parseLegacyNotificationBody("unknown", "x") === null, "unknown types must not invent data");
  assert(parseNotificationData('{"actorName":"Sam"}')?.actorName === "Sam", "stored JSON must parse");
  assert(parseNotificationData("not json") === null, "bad JSON must stay null");

  // A new-row payload round-trips through the inbox query, and the UI renders from data.
  const { getDb } = await import("../src/db/client");
  const { notifications, issues, workspaceMembers } = await import("../src/db/schema");
  const { listNotificationPage } = await import("../src/lib/issues");
  const db = getDb();
  const [issue] = await db.select().from(issues).limit(1);
  assert(issue, "seed data needs a task");
  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where((await import("drizzle-orm")).eq(workspaceMembers.workspaceId, issue.workspaceId))
    .limit(1);
  assert(member, "seed data needs a member");
  const id = crypto.randomUUID();
  await db.insert(notifications).values({
    id,
    workspaceId: issue.workspaceId,
    userId: member.userId,
    issueId: issue.id,
    type: "assigned",
    body: "",
    data: JSON.stringify({ actorName: "Sam", title: issue.title }),
    state: "unread",
    createdAt: new Date().toISOString(),
  });
  const page = await listNotificationPage(issue.workspaceId, member.userId, { tab: "assigned" });
  const row = page.rows.find((item) => item.id === id);
  assert(row, "new assignment must be listed");
  assert(row.data?.actorName === "Sam" && row.data.title === issue.title, "listed row must carry parsed data");
  assert(row.body === "", "new rows must not store an English sentence");

  const view = fs.readFileSync(path.join(process.cwd(), "src/components/notifications-view.tsx"), "utf8");
  assert(view.includes("parseLegacyNotificationBody"), "the view must fall back for old rows");
  assert(view.includes('case "assigned"'), "the view must render assigned notices from data");
  assert(view.includes("{name} assigned you to"), "the assigned sentence must be localized");
  assert(!view.includes("item.body}") || view.includes("?? item.body"), "the view must prefer data over legacy body");
  console.log("check-inbox-payload: pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
