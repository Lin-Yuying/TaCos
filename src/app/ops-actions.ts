"use server";
import { requireOpsAdmin, requireOpsOwner } from "@/lib/ops/auth";
import {
  createBackup,
  restoreBackup,
  saveBackupRetentionDays,
} from "@/lib/ops/backups";
import { buildSystemSnapshot } from "@/lib/ops/snapshot";
import type { ActionResult } from "./actions";

async function run<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not read system status. Retry.",
    };
  }
}

/** Refresh everything the System page shows. Admins only; no mutations here. */
export async function systemSnapshotAction(workspaceId: string) {
  return run(async () => {
    await requireOpsAdmin(workspaceId);
    return buildSystemSnapshot(workspaceId);
  });
}

/** "Back up now": a verified copy of the database and uploads, recorded in backup_runs. */
export async function runBackupAction(workspaceId: string) {
  return run(async () => {
    const context = await requireOpsAdmin(workspaceId);
    await createBackup("manual", context.user.username);
    return buildSystemSnapshot(workspaceId);
  });
}

/** The automatic snapshot the installer takes before replacing the server app. */
export async function createPreUpgradeBackupAction(workspaceId: string) {
  return run(async () => {
    const context = await requireOpsAdmin(workspaceId);
    await createBackup("pre_upgrade", context.user.username);
    return buildSystemSnapshot(workspaceId);
  });
}

export async function saveBackupRetentionAction(workspaceId: string, days: number) {
  return run(async () => {
    await requireOpsOwner(workspaceId);
    await saveBackupRetentionDays(days);
    return buildSystemSnapshot(workspaceId);
  });
}

/** Destructive: replaces the database. The typed phrase is enforced in lib, not only here. */
export async function restoreBackupAction(
  workspaceId: string,
  backupName: string,
  confirmation: string
) {
  return run(async () => {
    const context = await requireOpsOwner(workspaceId);
    const result = await restoreBackup(backupName, confirmation, context.user.username);
    return { result, snapshot: await buildSystemSnapshot(workspaceId) };
  });
}
