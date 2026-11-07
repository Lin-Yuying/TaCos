/**
 * U-05 secret scan: export a workspace full of credentials, then prove that no
 * password hash, API key, provider key, runner token, session or join code appears in
 * any file the archive generates. API keys may appear as names and scopes only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-export-secrets-"));
process.env.TACOS_DATA_DIR = path.join(root, "data");
process.env.TACOS_SEED_DEMO = "0";

const FORBIDDEN_KEYS = /^(password|passwordhash|keyhash|key_hash|apikey|api_key|token|tokenhash|token_hash|secret|session|join_code|joincode|migrat\w*|webhook\w*)$/i;

function inspectKeys(value: unknown, trail = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectKeys(entry, `${trail}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!FORBIDDEN_KEYS.test(key), `no secret field ${trail}.${key}`);
    inspectKeys(child, `${trail}.${key}`);
  }
}

async function main() {
  const { getDb, hashPassword } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const issues = await import("../src/lib/issues");
  const { writeWorkspaceExport } = await import("../src/lib/export/workspace");
  const { ZipReader } = await import("../src/lib/transfer/zip");

  const db = getDb();
  const now = new Date().toISOString();
  const password = "owner-password-2f5a";
  const passwordHash = hashPassword(password);
  db.insert(schema.users)
    .values({ id: "owner", username: "owner", displayName: "Olive Owner", passwordHash, role: "admin", createdAt: now })
    .run();
  const workspace = await issues.createWorkspace({ name: "Secrets", key: "SEC", adminUserId: "owner" });
  const project = await issues.createProject({ workspaceId: workspace.id, name: "Core", createdBy: "owner" });
  const api = await issues.createApiKey(
    workspace.id,
    "Deploy automation",
    ["read", "write"],
    [project.id],
    90,
    "owner"
  );
  const [keyRow] = await db
    .select()
    .from(schema.apiKeys)
    .where((await import("drizzle-orm")).eq(schema.apiKeys.id, api.record.id));
  assert.ok(keyRow, "the API key row exists");
  const modelKey = "sk-provider-key-7c1d";
  db.insert(schema.userModelKeys)
    .values({ userId: "owner", provider: "openai", apiKey: modelKey, updatedAt: now })
    .run();
  const aiKey = "sk-ai-settings-9e2b";
  db.insert(schema.aiSettings)
    .values({ workspaceId: workspace.id, baseUrl: "https://api.example.com", model: "model", apiKey: aiKey, updatedAt: now })
    .run();
  const runnerHash = "runner-token-hash-4b8a";
  db.insert(schema.runnerTokens).values({ tokenHash: runnerHash, userId: "owner", createdAt: now }).run();
  const sessionId = "session-secret-e3c0";
  db.insert(schema.sessions)
    .values({ id: sessionId, userId: "owner", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), createdAt: now })
    .run();

  // A normal document and task so the archive is not empty.
  await issues.createIssue(workspace.id, { title: "A task", project: project.key }, { kind: "user", userId: "owner", displayName: "Olive Owner" });
  await (await import("../src/lib/pages")).createPage(workspace.id, "owner", { title: "Doc", doc: "Body" });

  const zipPath = path.join(root, "secrets.zip");
  const exported = await writeWorkspaceExport(workspace.id, zipPath, { includeAttachments: false });
  assert.equal(exported.counts.apiKeys, 1);

  const reader = await ZipReader.open(zipPath);
  const entries = reader.list().filter((entry) => !entry.directory);
  const texts = new Map<string, string>();
  for (const entry of entries) {
    if (entry.name.startsWith("attachments/") && entry.name !== "attachments/manifest.json") continue;
    texts.set(entry.name, (await reader.read(entry, 32 * 1024 * 1024)).toString("utf8"));
  }
  const forbidden: Array<[string, string]> = [
    ["the account password", password],
    ["the password hash", passwordHash],
    ["the raw API key", api.key],
    ["the API key hash", keyRow.keyHash],
    ["the provider model key", modelKey],
    ["the workspace AI key", aiKey],
    ["the runner token hash", runnerHash],
    ["the session id", sessionId],
    ["the join code", workspace.joinCode],
  ];
  for (const [label, value] of forbidden) {
    assert.ok(value && value.length >= 4, `${label} has a value to search for`);
    for (const [name, text] of texts) {
      assert.ok(!text.includes(value), `${name} does not contain ${label}`);
    }
  }
  const workspaceJson = JSON.parse(texts.get("workspace.json")!);
  inspectKeys(workspaceJson);
  assert.equal(workspaceJson.apiKeys.length, 1);
  assert.deepEqual(Object.keys(workspaceJson.apiKeys[0]).sort(), [
    "createdAt",
    "expiresAt",
    "name",
    "projectKeys",
    "revokedAt",
    "scopes",
  ]);
  assert.equal(workspaceJson.apiKeys[0].name, "Deploy automation");
  assert.deepEqual(workspaceJson.apiKeys[0].scopes, ["read", "write"]);
  assert.deepEqual(workspaceJson.apiKeys[0].projectKeys, [project.key]);
  assert.ok(!texts.get("manifest.json")!.includes(root), "no server path is exported");
  assert.ok(!texts.get("workspace.json")!.includes(root), "no server path is exported");
  await reader.close();

  console.log(
    "check-export-secrets: pass (password/hash, API key/hash, model key, AI key, runner token, session and join code absent; API keys export name/scopes/projects only)"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
