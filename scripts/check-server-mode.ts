/**
 * Server mode starts no CLI (docs/plans/team-2.2.md item 1). Also drives the SSH tunnel with a
 * fake ssh, which listens like a forward would: killing it must bring the port back.
 *   npx tsx scripts/check-server-mode.ts
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

function assert(ok: unknown, message: string) {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

const data = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-server-mode-"));
process.env.TACOS_DATA_DIR = data;
process.env.TACOS_SERVER_MODE = "1";

async function main() {
  const { getHarnessAdapter, listHarnessDetect, runHarnessInstall, runHarnessUpgrade } = await import(
    "../src/lib/harness/registry"
  );
  const { listCliStatuses, listCodexModels, listCodexSkills, requireCli, openCliStream } = await import(
    "../src/lib/cli-agents"
  );

  for (const row of listHarnessDetect()) {
    assert(!row.installed && !row.ready && !row.binary, `${row.id} must not look installed`);
    assert(getHarnessAdapter(row.id) === null, `${row.id} adapter must be unavailable`);
    assert(!(await runHarnessInstall(row.id)).ok, `${row.id} install must be refused`);
    assert(!(await runHarnessUpgrade(row.id)).ok, `${row.id} upgrade must be refused`);
  }
  assert(listCliStatuses().length === 0, "no CLI status on a server");
  assert(listCodexModels().length === 0, "no Codex models on a server");
  assert((await listCodexSkills()).length === 0, "no Codex skills on a server");
  for (const call of [
    () => requireCli("codex"),
    () => requireCli("pi"),
    () => openCliStream("codex", { system: "", body: "" }, { proxy: "" }),
    () => openCliStream("pi", { system: "", body: "" }, { proxy: "" }),
  ]) {
    let refused = false;
    try {
      call();
    } catch {
      refused = true;
    }
    assert(refused, "CLI path must be refused");
  }
  console.log("ok server mode refuses every CLI path");

  const { createTunnel, parseTarget, sshArgs } = require("../electron/ssh-tunnel.js");
  for (const bad of ["-oProxyCommand=x@h", "user", "a b@host", "u@-h", "u@h;rm"]) {
    assert(parseTarget(bad) === null, `target ${bad} must be refused`);
  }
  const args: string[] = sshArgs({ user: "tacos", host: "h", localPort: 1, remotePort: 2 });
  assert(args.includes("BatchMode=yes"), "no prompt in the tunnel");
  assert(args.includes("127.0.0.1:1:127.0.0.1:2"), "forward binds loopback on both ends");

  const fake = path.join(data, "fake-ssh.cjs");
  fs.writeFileSync(
    fake,
    `#!${process.execPath}
const net = require("node:net");
const spec = process.argv[process.argv.indexOf("-L") + 1];
const port = Number(spec.split(":")[1]);
net.createServer((socket) => socket.end("ok")).listen(port, "127.0.0.1");
`
  );
  fs.chmodSync(fake, 0o755);

  const localPort = await new Promise<number>((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
  const tunnel = createTunnel({ user: "tacos", host: "h", localPort, remotePort: 2, sshPath: fake });
  tunnel.start();
  assert(await tunnel.waitReady(), "tunnel comes up");
  const first = tunnel.pid();
  process.kill(first, "SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert(await tunnel.waitReady(10_000), "tunnel comes back after ssh is killed");
  assert(tunnel.pid() !== first, "a new ssh is running");
  tunnel.stop();
  console.log("ok tunnel reconnects after a killed ssh");

  const { createSkillFile, deleteSkillFile } = await import("../src/lib/skill-files");
  for (const call of [
    () => createSkillFile({ name: "x", description: "x", instructions: "x" }),
    () => deleteSkillFile("/nowhere/x/SKILL.md"),
  ]) {
    let message = "";
    try {
      call();
    } catch (err) {
      message = (err as Error).message;
    }
    assert(message.includes("not on this server"), "skill folders must be refused on a server");
  }

  // Security triage: a key leaves with the person who made it; a reset locks the old session out.
  const { createSiteMember, setMemberPassword } = await import("../src/lib/admin");
  const { createApiKey, createWorkspace, inviteMember, removeMember, verifyApiKey } = await import("../src/lib/issues");
  const { createSession } = await import("../src/lib/auth");
  const { getDb } = await import("../src/db/client");
  const { sessions } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const sessionRows = (id: string) => getDb().select().from(sessions).where(eq(sessions.id, id));
  const owner = await createSiteMember({ username: "owner", displayName: "Owner", password: "password-1" });
  const member = await createSiteMember({ username: "member", displayName: "Member", password: "password-1" });
  const workspace = await createWorkspace({ name: "Team", key: "TEAM", adminUserId: owner.id });
  await inviteMember(workspace.id, "member");
  const { key } = await createApiKey(workspace.id, "script", member.id);
  assert(await verifyApiKey(key), "a member's key works");
  await removeMember(workspace.id, member.id);
  assert(!(await verifyApiKey(key)), "a removed member's key must stop working");
  const session = await createSession(member.id);
  assert((await sessionRows(session)).length === 1, "session exists");
  await setMemberPassword(member.id, "password-2");
  assert((await sessionRows(session)).length === 0, "a password reset must end old sessions");
  console.log("ok security triage");

  // Deployment: never public, never demo data, never the default password.
  const env = fs.readFileSync("deploy/install.sh", "utf8");
  for (const line of ["HOSTNAME=127.0.0.1", "TACOS_SERVER_MODE=1", "TACOS_SEED_DEMO=0", "TACOS_ADMIN_PASSWORD=$ADMIN_PASSWORD"]) {
    assert(env.includes(line), `install.sh must set ${line}`);
  }
  assert(!/morula|caddy/i.test(env), "install.sh must not touch other services");
  execFileSync("bash", ["-n", "deploy/install.sh"]);
  execFileSync("bash", ["-n", "deploy/add-member-key.sh"]);
  console.log("ok deployment files");
  process.exit(0);
}

void main();
