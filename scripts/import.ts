/**
 * U-05 ops import CLI:
 *   npm run import -- <workspace.zip|folder|tasks.csv> [--name "Workspace"] [--owner username]
 *                    [--no-attachments] [--dry-run]
 *
 * Same planner and applier as Settings. A dry run prints the preview and writes
 * nothing; the real run creates a new workspace or reuses the one an identical import
 * already produced.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { applyImportPlan } from "../src/lib/import/apply";
import { buildImportPlan } from "../src/lib/import/plan";
import { buildImportZip, fingerprintZip } from "../src/lib/import/source";
import { IMPORT_DIR, createTransferJob, updateTransferJob } from "../src/lib/transfer/jobs";
import { recordTransferAudit } from "../src/lib/transfer/audit";

function usage(message?: string): never {
  if (message) console.error(`Error: ${message}`);
  console.error(
    'Usage: npm run import -- <workspace.zip|folder|tasks.csv> [--name "Workspace"] [--owner username] [--no-attachments] [--dry-run]'
  );
  process.exit(1);
}

async function folderFiles(root: string): Promise<Array<{ name: string; data: Buffer }>> {
  const files: Array<{ name: string; data: Buffer }> = [];
  const walk = async (dir: string) => {
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        files.push({ name: path.relative(root, full).split(path.sep).join("/"), data: await fs.promises.readFile(full) });
      }
    }
  };
  await walk(root);
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  let target = "";
  let name: string | null = null;
  let ownerName: string | null = null;
  let includeAttachments = true;
  let dryRun = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--name") name = args[++index] ?? usage("--name needs a value");
    else if (arg === "--owner") ownerName = args[++index] ?? usage("--owner needs a username");
    else if (arg === "--no-attachments") includeAttachments = false;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--help" || arg === "-h") usage();
    else if (arg.startsWith("-")) usage(`Unknown option ${arg}`);
    else if (!target) target = arg;
    else usage(`Unexpected argument ${arg}`);
  }
  if (!target) usage("Name a ZIP, folder or CSV file");
  const source = path.resolve(target);
  const stat = await fs.promises.stat(source).catch(() => null);
  if (!stat) usage(`"${target}" does not exist`);

  const ownerRows = await getDb().select().from(users);
  const owner =
    (ownerName
      ? ownerRows.find((row) => row.username.toLowerCase() === ownerName!.toLowerCase())
      : ownerRows.find((row) => row.role === "admin") ?? ownerRows[0]) ?? null;
  if (!owner) usage("No account can own the imported workspace; pass --owner <username>");

  let archive = source;
  let temp: string | null = null;
  if (stat.isDirectory()) {
    fs.mkdirSync(IMPORT_DIR, { recursive: true });
    temp = path.join(IMPORT_DIR, `.cli-${crypto.randomUUID()}.zip`);
    await buildImportZip(temp, await folderFiles(source));
    archive = temp;
  } else if (!/\.zip$/i.test(source)) {
    fs.mkdirSync(IMPORT_DIR, { recursive: true });
    temp = path.join(IMPORT_DIR, `.cli-${crypto.randomUUID()}.zip`);
    await buildImportZip(temp, [{ name: path.basename(source), data: await fs.promises.readFile(source) }]);
    archive = temp;
  }
  try {
    const bytes = (await fs.promises.stat(archive)).size;
    const fingerprint = await fingerprintZip(archive);
    const plan = await buildImportPlan({
      sourcePath: archive,
      fileName: path.basename(source),
      bytes,
      fingerprint,
      options: {
        includeAttachments,
        ...(name ? { workspaceName: name } : {}),
      },
      actorId: owner.id,
    });
    const counts = plan.counts;
    console.log(
      `Preview: ${counts.projects} projects, ${counts.tasks} tasks, ${counts.documents} documents, ` +
        `${counts.comments} comments, ${counts.attachments} attachments (${(counts.attachmentBytes / 1024 / 1024).toFixed(2)} MB).`
    );
    if (plan.conflicts.length > 0) {
      console.log(`${plan.conflicts.length} conflicts:`);
      for (const conflict of plan.conflicts) console.log(`  - ${conflict.message} (${conflict.count})`);
    }
    if (plan.unmapped.length > 0) {
      console.log(`${plan.unmapped.length} unmapped fields:`);
      for (const field of plan.unmapped) console.log(`  - ${field.source}: ${field.field} (${field.count})`);
    }
    for (const warning of plan.warnings) console.log(`  warning: ${warning}`);
    if (plan.duplicateWorkspaceId) {
      console.log(`This exact import already created workspace ${plan.duplicateWorkspaceId}; nothing to do.`);
      return;
    }
    if (dryRun) {
      console.log("Dry run: nothing was written.");
      return;
    }
    if (plan.projects.length === 0 && plan.issues.length === 0 && plan.pages.length === 0) {
      usage("Nothing to import: the source has no tasks, documents or projects");
    }
    let lastPhase = "";
    const applied = await applyImportPlan({
      plan,
      sourcePath: archive,
      actor: { id: owner.id, username: owner.username, displayName: owner.displayName },
      onProgress: (phase) => {
        if (phase !== lastPhase) {
          lastPhase = phase;
          console.log(`${phase}…`);
        }
      },
    });
    const job = await createTransferJob({
      kind: "import",
      workspaceId: applied.workspaceId,
      createdBy: owner.id,
      fingerprint: plan.fingerprint,
      summary: { via: "cli", fileName: path.basename(source), workspaceName: applied.workspaceName },
    });
    await updateTransferJob(
      job.id,
      {
        status: "done",
        phase: "Done",
        progress: 100,
        targetWorkspaceId: applied.workspaceId,
        finishedAt: new Date().toISOString(),
        summary: {
          via: "cli",
          sourceId: job.id,
          fileName: path.basename(source),
          workspace: { id: applied.workspaceId, name: applied.workspaceName, key: applied.workspaceKey },
          targetWorkspaceId: applied.workspaceId,
          workspaceName: applied.workspaceName,
          counts: applied.counts,
          warnings: applied.warnings,
        },
      },
      { force: true }
    );
    await recordTransferAudit({
      workspaceId: applied.workspaceId,
      type: "import_completed",
      actor: { kind: "user", userId: owner.id, displayName: owner.displayName },
      data: { via: "cli", fileName: path.basename(source), counts: applied.counts },
    });
    console.log(
      `\nImported into "${applied.workspaceName}" (${applied.workspaceKey}) as ${owner.username}: ` +
        `${applied.counts.tasks} tasks, ${applied.counts.documents} documents, ${applied.counts.attachments} attachments.`
    );
    console.log(`Workspace id: ${applied.workspaceId}`);
    for (const warning of applied.warnings) console.log(`  warning: ${warning}`);
  } finally {
    if (temp) await fs.promises.rm(temp, { force: true });
  }
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
