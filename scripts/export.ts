/**
 * U-05 ops CLI: npm run export -- <workspace id or key> [--out <file>] [--no-attachments]
 *
 * It uses the same collector as the UI/API, writes the same canonical zip and records
 * the same audit event, attributed to "cli:export". No login is needed because whoever
 * can run this already has the database file.
 */
import path from "node:path";
import { or, eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { workspaces } from "../src/db/schema";
import { exportFileName, writeWorkspaceExport } from "../src/lib/export/workspace";
import { recordTransferAudit } from "../src/lib/transfer/audit";

function usage(message?: string): never {
  if (message) console.error(`Error: ${message}`);
  console.error("Usage: npm run export -- <workspace id or key> [--out <file>] [--no-attachments]");
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  let target = "";
  let output: string | null = null;
  let includeAttachments = true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--out") {
      output = args[++i] ?? null;
      if (!output) usage("--out needs a file path");
    } else if (arg === "--no-attachments") {
      includeAttachments = false;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else if (arg.startsWith("-")) {
      usage(`Unknown option ${arg}`);
    } else if (!target) {
      target = arg;
    } else {
      usage(`Unexpected argument ${arg}`);
    }
  }
  if (!target) usage("Name a workspace id or key");

  const db = getDb();
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(or(eq(workspaces.id, target), eq(workspaces.key, target.toUpperCase())))
    .limit(1);
  if (!workspace || workspace.deletedAt) usage(`Workspace "${target}" not found`);

  const file = output
    ? path.resolve(output)
    : path.resolve(exportFileName(workspace));
  let lastPhase = "";
  const result = await writeWorkspaceExport(workspace.id, file, {
    includeAttachments,
    onProgress: (phase, progress) => {
      if (phase !== lastPhase) {
        lastPhase = phase;
        process.stdout.write(`${phase}…\n`);
      }
      if (progress >= 100) process.stdout.write("");
    },
  });
  await recordTransferAudit({
    workspaceId: workspace.id,
    type: "export_completed",
    actor: { kind: "agent", label: "cli:export" },
    data: {
      via: "cli",
      fileName: path.basename(file),
      bytes: result.bytes,
      counts: result.counts,
      attachments: result.attachments,
    },
  });
  const mb = (result.bytes / 1024 / 1024).toFixed(2);
  console.log(`\nExported ${result.workspace.name} (${result.workspace.key}) to ${file}`);
  console.log(
    `${result.counts.tasks} tasks, ${result.counts.documents} documents, ${result.counts.comments} comments, ` +
      `${result.attachments.includedCount} attachments (${mb} MB zip, ${result.entries} entries).`
  );
  if (result.attachments.omittedCount > 0) {
    console.log(
      `${result.attachments.omittedCount} attachments were left out of the archive ` +
        `(${(result.attachments.omittedBytes / 1024 / 1024).toFixed(2)} MB); rerun without a cap or export without attachments.`
    );
  }
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
