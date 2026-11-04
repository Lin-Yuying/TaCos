// H-COLLAB-12: an invite link opens a join page for the workspace, and an admin can
// add an existing account by user name.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-invite-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const root = process.cwd();
  assert(fs.existsSync(path.join(root, "src/app/join/[code]/page.tsx")), "an invite link page /join/[code] must exist");
  const dialog = fs.readFileSync(path.join(root, "src/components/invite-dialog.tsx"), "utf8");
  assert(dialog.includes("/join/"), "the invite dialog must show the invite link");
  assert(dialog.includes("inviteMemberAction"), "the invite dialog must invite by user name");
  const actions = fs.readFileSync(path.join(root, "src/app/auth-actions.ts"), "utf8");
  assert(/inviteMemberAction[\s\S]{0,400}requireAdmin/.test(actions), "only an admin may invite directly");

  const { getDb } = await import("../src/db/client");
  const { users, workspaceMembers, workspaces } = await import("../src/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const lib = (await import("../src/lib/issues")) as Record<string, unknown>;
  const describe = lib.describeInvite as ((code: string) => Promise<{ name: string } | null>) | undefined;
  const invite = lib.inviteMember as ((ws: string, who: string) => Promise<{ username: string }>) | undefined;
  assert(typeof describe === "function" && typeof invite === "function", "describeInvite and inviteMember must exist");
  const { getJoinCode, joinWorkspace, rotateJoinCode } = await import("../src/lib/issues");
  const db = getDb();
  const [ws] = await db.select().from(workspaces).limit(1);
  const code = (await getJoinCode(ws.id))!;
  assert((await describe(code))?.name === ws.name, "describeInvite must name the workspace");
  assert((await describe("TACOS-NOPE")) === null, "an unknown code must give null");

  const now = new Date().toISOString();
  const mk = async (username: string) => {
    const id = crypto.randomUUID();
    await db.insert(users).values({ id, username, displayName: username, passwordHash: "x", createdAt: now } as never);
    return id;
  };
  const newcomer = await mk("newcomer");
  await joinWorkspace({ code, userId: newcomer });
  const isMember = async (userId: string) =>
    (await db.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, userId)))).length === 1;
  assert(await isMember(newcomer), "a new user joins through the invite link code");

  const existing = await mk("existing.user");
  const added = await invite(ws.id, "@Existing.User");
  assert(added.username === "existing.user" && (await isMember(existing)), "an admin adds an existing user by user name");
  let threw = false;
  try { await invite(ws.id, "existing.user"); } catch { threw = true; }
  assert(threw, "inviting a member twice must fail");
  threw = false;
  try { await invite(ws.id, "ghost"); } catch { threw = true; }
  assert(threw, "an unknown user name must fail");

  const fresh = await rotateJoinCode(ws.id, existing);
  assert((await describe(code)) === null && (await describe(fresh)) !== null, "rotating the code must kill the old link");
  console.log("check-collab-invites: pass");
}

main().catch((err) => {
  console.error("check-collab-invites: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
