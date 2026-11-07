import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { DATA_DIR } from "@/lib/data-dir";
import { transferJobs } from "@/db/schema";
import { signTransferToken } from "./sign";

export const EXPORT_DIR = path.join(DATA_DIR, "exports");
export const IMPORT_DIR = path.join(DATA_DIR, "imports");
export const DOWNLOAD_TTL_MS = 15 * 60 * 1000;
const JOB_RETENTION_DAYS = 30;
const ARTIFACT_RETENTION_DAYS = 7;
const STALE_AFTER_MS = 15 * 60 * 1000;
// A job row written before this process started cannot still be running: the work was
// an in-process promise, not a durable queue item.
const PROCESS_STARTED_AT = Date.now();

function staleCutoff(now = Date.now()): string {
  return new Date(Math.min(now - STALE_AFTER_MS, PROCESS_STARTED_AT)).toISOString();
}

export type TransferKind = "export" | "import";
export type TransferStatus = "queued" | "running" | "done" | "failed";

type JobRow = typeof transferJobs.$inferSelect;

export type TransferJob = {
  id: string;
  kind: TransferKind;
  workspaceId: string;
  targetWorkspaceId: string | null;
  createdBy: string;
  status: TransferStatus;
  phase: string;
  progress: number;
  summary: Record<string, unknown>;
  error: string | null;
  artifactPath: string | null;
  artifactName: string | null;
  artifactBytes: number | null;
  fingerprint: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type TransferJobView = TransferJob & { downloadUrl: string | null };

function parseSummary(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toJob(row: JobRow): TransferJob {
  return {
    id: row.id,
    kind: row.kind as TransferKind,
    workspaceId: row.workspaceId,
    targetWorkspaceId: row.targetWorkspaceId ?? null,
    createdBy: row.createdBy,
    status: row.status as TransferStatus,
    phase: row.phase,
    progress: row.progress,
    summary: parseSummary(row.summary),
    error: row.error ?? null,
    artifactPath: row.artifactPath ?? null,
    artifactName: row.artifactName ?? null,
    artifactBytes: row.artifactBytes ?? null,
    fingerprint: row.fingerprint ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt ?? null,
  };
}

export function toJobView(job: TransferJob, now = Date.now()): TransferJobView {
  const downloadUrl =
    job.kind === "export" && job.status === "done" && job.artifactPath
      ? `/api/export/download?token=${signTransferToken(job.id, now + DOWNLOAD_TTL_MS)}`
      : null;
  return { ...job, downloadUrl };
}

export async function createTransferJob(input: {
  kind: TransferKind;
  workspaceId: string;
  createdBy: string;
  fingerprint?: string | null;
  summary?: Record<string, unknown>;
}): Promise<TransferJob> {
  const at = new Date().toISOString();
  const row: typeof transferJobs.$inferInsert = {
    id: crypto.randomUUID(),
    kind: input.kind,
    workspaceId: input.workspaceId,
    createdBy: input.createdBy,
    status: "queued",
    phase: "Queued",
    progress: 0,
    summary: JSON.stringify(input.summary ?? {}),
    fingerprint: input.fingerprint ?? null,
    createdAt: at,
    updatedAt: at,
  };
  await getDb().insert(transferJobs).values(row);
  return toJob({ ...row, targetWorkspaceId: null, error: null, artifactPath: null, artifactName: null, artifactBytes: null, expiresAt: null, finishedAt: null } as JobRow);
}

export async function getTransferJob(id: string): Promise<TransferJob | null> {
  const [row] = await getDb().select().from(transferJobs).where(eq(transferJobs.id, id)).limit(1);
  return row ? toJob(row) : null;
}

export type TransferPatch = {
  status?: TransferStatus;
  phase?: string;
  progress?: number;
  summary?: Record<string, unknown>;
  error?: string | null;
  artifactPath?: string | null;
  artifactName?: string | null;
  artifactBytes?: number | null;
  targetWorkspaceId?: string | null;
  finishedAt?: string | null;
};

const lastWrite = new Map<string, { at: number; phase: string; progress: number }>();

/**
 * Progress is polled from another request; writing every item would make SQLite the
 * bottleneck. A phase change or a 2% step is enough for the UI, and `force` covers the
 * final state.
 */
export async function updateTransferJob(
  id: string,
  patch: TransferPatch,
  options: { force?: boolean } = {}
): Promise<void> {
  const previous = lastWrite.get(id);
  const now = Date.now();
  if (
    !options.force &&
    patch.status === undefined &&
    patch.error === undefined &&
    patch.artifactPath === undefined &&
    patch.targetWorkspaceId === undefined &&
    previous &&
    now - previous.at < 400 &&
    patch.phase === previous.phase &&
    Math.abs((patch.progress ?? previous.progress) - previous.progress) < 2
  ) {
    return;
  }
  const update: Partial<typeof transferJobs.$inferInsert> = { updatedAt: new Date(now).toISOString() };
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.phase !== undefined) update.phase = patch.phase;
  if (patch.progress !== undefined) update.progress = Math.max(0, Math.min(100, Math.round(patch.progress)));
  if (patch.summary !== undefined) update.summary = JSON.stringify(patch.summary);
  if (patch.error !== undefined) update.error = patch.error;
  if (patch.artifactPath !== undefined) update.artifactPath = patch.artifactPath;
  if (patch.artifactName !== undefined) update.artifactName = patch.artifactName;
  if (patch.artifactBytes !== undefined) update.artifactBytes = patch.artifactBytes;
  if (patch.targetWorkspaceId !== undefined) update.targetWorkspaceId = patch.targetWorkspaceId;
  if (patch.finishedAt !== undefined) update.finishedAt = patch.finishedAt;
  await getDb().update(transferJobs).set(update).where(eq(transferJobs.id, id));
  if (patch.phase !== undefined || patch.progress !== undefined) {
    lastWrite.set(id, {
      at: now,
      phase: patch.phase ?? previous?.phase ?? "",
      progress: patch.progress ?? previous?.progress ?? 0,
    });
  }
  if (patch.status === "done" || patch.status === "failed") lastWrite.delete(id);
}

export async function listTransferJobs(
  workspaceId: string,
  kind: TransferKind,
  limit = 10
): Promise<TransferJob[]> {
  const rows = await getDb()
    .select()
    .from(transferJobs)
    .where(and(eq(transferJobs.workspaceId, workspaceId), eq(transferJobs.kind, kind)))
    .orderBy(desc(transferJobs.createdAt))
    .limit(limit);
  return rows.map(toJob);
}

export async function findRunningTransfer(workspaceId: string, kind: TransferKind): Promise<TransferJob | null> {
  const cutoff = staleCutoff();
  const [row] = await getDb()
    .select()
    .from(transferJobs)
    .where(
      and(
        eq(transferJobs.workspaceId, workspaceId),
        eq(transferJobs.kind, kind),
        inArray(transferJobs.status, ["queued", "running"]),
        sql`${transferJobs.updatedAt} >= ${cutoff}`
      )
    )
    .orderBy(desc(transferJobs.createdAt))
    .limit(1);
  return row ? toJob(row) : null;
}

/** A repeated identical import is a no-op: its fingerprint points at the first result. */
export async function completedImportForFingerprint(
  fingerprint: string,
  createdBy: string
): Promise<TransferJob | null> {
  const [row] = await getDb()
    .select()
    .from(transferJobs)
    .where(
      and(
        eq(transferJobs.kind, "import"),
        eq(transferJobs.status, "done"),
        eq(transferJobs.fingerprint, fingerprint),
        eq(transferJobs.createdBy, createdBy)
      )
    )
    .orderBy(desc(transferJobs.createdAt))
    .limit(1);
  return row ? toJob(row) : null;
}

const localRunning = new Set<string>();

export function claimTransferSlot(kind: TransferKind, workspaceId: string): boolean {
  const key = `${kind}:${workspaceId}`;
  if (localRunning.has(key)) return false;
  localRunning.add(key);
  return true;
}

export function releaseTransferSlot(kind: TransferKind, workspaceId: string): void {
  localRunning.delete(`${kind}:${workspaceId}`);
}

/**
 * A restart cannot resume an in-process job. Mark those rows failed and remove the
 * hidden workspace an interrupted import had created, so no half-import survives.
 */
export async function recoverStaleTransfers(): Promise<void> {
  const cutoff = staleCutoff();
  const rows = await getDb()
    .select()
    .from(transferJobs)
    .where(and(inArray(transferJobs.status, ["queued", "running"]), lt(transferJobs.updatedAt, cutoff)));
  for (const row of rows) {
    await updateTransferJob(
      row.id,
      {
        status: "failed",
        error: "The server restarted before this job finished. Start it again.",
        finishedAt: new Date().toISOString(),
      },
      { force: true }
    );
    if (row.kind === "import" && row.targetWorkspaceId) {
      const { rollbackImportedWorkspace } = await import("@/lib/import/apply");
      await rollbackImportedWorkspace(row.targetWorkspaceId).catch((error: unknown) =>
        console.error("Import rollback after restart:", error)
      );
    }
  }
  await cleanStaleTransfers();
}

function olderThanDays(days: number): number {
  return Date.now() - days * 86_400_000;
}

/** Lazy cleanup: no background timer; opening Export/Import is the sweep. */
export async function cleanStaleTransfers(): Promise<void> {
  for (const dir of [EXPORT_DIR, IMPORT_DIR]) fs.mkdirSync(dir, { recursive: true });
  const artifactCutoff = olderThanDays(ARTIFACT_RETENTION_DAYS);
  for (const name of await fs.promises.readdir(EXPORT_DIR)) {
    const file = path.join(EXPORT_DIR, name);
    try {
      const stat = await fs.promises.stat(file);
      if (stat.isFile() && stat.mtimeMs < artifactCutoff) await fs.promises.rm(file, { force: true });
    } catch {
      // A file removed by another sweep is already clean.
    }
  }
  const sourceCutoff = olderThanDays(1);
  for (const name of await fs.promises.readdir(IMPORT_DIR)) {
    const file = path.join(IMPORT_DIR, name);
    try {
      const stat = await fs.promises.stat(file);
      if (stat.isFile() && stat.mtimeMs < sourceCutoff) await fs.promises.rm(file, { force: true });
    } catch {
      // same
    }
  }
  await getDb()
    .delete(transferJobs)
    .where(lt(transferJobs.createdAt, new Date(olderThanDays(JOB_RETENTION_DAYS)).toISOString()));
}
