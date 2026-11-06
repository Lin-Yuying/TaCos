/**
 * #79 harness v2 seam: native sessions are stored per thread+harness and the adapters use
 * them where supported (Codex thread/resume, OpenCode --session, dsh --session-id);
 * Pi keeps the documented history-replay fallback. Run: npx tsx scripts/check-agent-session.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-session-"));
process.env.TACOS_SEED_DEMO = "0";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
const read = (rel: string) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

async function main() {
  const { getDb } = await import("../src/db/client");
  const { agentHarnessSessions, agentThreads, projects, users, workspaces } = await import("../src/db/schema");

  const db = getDb();
  const now = new Date().toISOString();
  await db.insert(users).values({ id: "u1", username: "u1", displayName: "Uma", passwordHash: "x", createdAt: now } as never);
  await db.insert(workspaces).values({ id: "w1", name: "Ses", key: "SES", createdBy: "u1", createdAt: now } as never);
  await db.insert(projects).values({ id: "p1", workspaceId: "w1", key: "SES", name: "One", createdBy: "u1", createdAt: now, updatedAt: now } as never);
  await db.insert(agentThreads).values({
    id: "t1",
    workspaceId: "w1",
    projectId: "p1",
    title: "one",
    engine: "codex",
    visibility: "private",
    createdBy: "u1",
    createdAt: now,
    updatedAt: now,
  } as never);

  const { getHarnessSession, saveHarnessSession } = await import("../src/lib/agent-threads");
  assert((await getHarnessSession("t1", "codex")) === null, "no session yet");
  await saveHarnessSession("t1", "codex", "thread-abc");
  await saveHarnessSession("t1", "opencode", "ses_123");
  assert((await getHarnessSession("t1", "codex")) === "thread-abc", "codex session stored");
  assert((await getHarnessSession("t1", "opencode")) === "ses_123", "opencode session stored");
  assert((await getHarnessSession("t1", "pi")) === null, "pi has no native session");
  await saveHarnessSession("t1", "codex", "thread-def");
  assert((await getHarnessSession("t1", "codex")) === "thread-def", "same harness updates in place");
  assert(db.select().from(agentHarnessSessions).all().length === 2, "one row per harness");

  const types = read("src/lib/harness/types.ts");
  assert(types.includes("nativeSessionId?: string | null"), "TurnInput carries a native session");
  assert(types.includes('| { type: "session"; id: string }'), "TurnEvent carries the session id");
  const codex = read("src/lib/harness/adapters/codex-turn.ts");
  assert(codex.includes("thread/resume") && codex.includes("input.nativeSessionId"), "Codex resumes its thread");
  assert(codex.includes("ephemeral: false"), "Codex keeps its thread");
  const opencode = read("src/lib/harness/adapters/opencode-turn.ts");
  assert(opencode.includes('"--session"') && opencode.includes("nativeSessionId"), "OpenCode reuses its session");
  const dsh = read("src/lib/harness/adapters/dsh-turn.ts");
  assert(dsh.includes("nativeSessionId") && dsh.includes("--session-id"), "dsh reuses its session");
  const pi = read("src/lib/harness/adapters/pi-turn.ts");
  assert(pi.includes("--no-session"), "Pi keeps the replay fallback");

  const route = read("src/app/api/ai/chat/route.ts");
  assert(route.includes("getHarnessSession") && route.includes("saveHarnessSession"), "the route wires session storage");
  assert(route.includes("nativeSessionId: nativeSession"), "the route passes the native session");
  const runner = read("src/runner/main.ts");
  assert(runner.includes("nativeSessionId: payload.nativeSessionId"), "the runner passes the native session");
  const protocol = read("src/lib/runner/protocol.ts");
  assert(protocol.includes("nativeSessionId?: string | null"), "the runner protocol carries it");

  console.log("check-agent-session: pass");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
