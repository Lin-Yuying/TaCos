// H-COLLAB-13: a change made by one member changes the workspace pulse, so the other
// window refreshes within 3 s without a reload.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-live-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const root = process.cwd();
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
  assert(fs.existsSync(path.join(root, "src/app/api/internal/[workspaceId]/live/route.ts")), "a live pulse route must exist");
  const client = fs.existsSync(path.join(root, "src/components/live-refresh.tsx")) ? read("src/components/live-refresh.tsx") : "";
  const interval = Number(/LIVE_POLL_MS\s*=\s*([\d_]+)/.exec(client)?.[1]?.replace(/_/g, "") ?? "0");
  assert(interval > 0 && interval <= 1500, "the client must poll at most every 1.5 s so a change shows within 3 s");
  assert(client.includes("router.refresh()") && client.includes("LIVE_EVENT"), "a pulse change must refresh the page and tell open panels");
  assert(read("src/components/workspace-shell.tsx").includes("<LiveRefresh"), "the workspace shell must mount LiveRefresh");
  assert(read("src/components/issue-panel/index.tsx").includes("useLiveTick"), "the task panel must reload on a live tick");

  const lib = (await import("../src/lib/issues")) as Record<string, unknown>;
  const pulse = lib.workspacePulse as ((ws: string, userId: string) => Promise<string>) | undefined;
  assert(typeof pulse === "function", "workspacePulse(ws, userId) must exist");
  const { getDb } = await import("../src/db/client");
  const { projects, users, workspaceMembers } = await import("../src/db/schema");
  const { createIssue, addComment, claimIssue, updateIssue } = await import("../src/lib/issues");
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const ws = project.workspaceId;
  const [a, b] = await db.select().from(users).limit(2);
  for (const u of [a, b]) {
    await db.insert(workspaceMembers).values({ workspaceId: ws, userId: u.id, createdAt: new Date().toISOString() }).onConflictDoNothing();
  }
  const actorA = { kind: "user", userId: a.id, displayName: a.displayName } as const;

  let seen = await pulse(ws, b.id);
  const changed = async (what: string) => {
    const next = await pulse(ws, b.id);
    assert(next !== seen, `${what} must change the pulse`);
    seen = next;
  };
  assert((await pulse(ws, b.id)) === seen, "the pulse must be stable with no change");
  const created = await createIssue(ws, { title: "Live test", project: project.key }, actorA);
  await changed("a new task");
  await addComment(ws, created.issue.id, `@${b.username} hi`, actorA);
  await changed("a comment and a mention notice");
  if (typeof claimIssue === "function") {
    await (claimIssue as never as (w: string, i: string, u: string) => Promise<unknown>)(ws, created.issue.id, b.id);
    await changed("a claim");
  }
  await updateIssue(ws, created.issue.id, { title: "Live test 2" }, actorA);
  await changed("a task edit");
  console.log("check-collab-live-refresh: pass");
}

main().catch((err) => {
  console.error("check-collab-live-refresh: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
