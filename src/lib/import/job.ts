import { TacosError } from "@/lib/tacos-error";
import { recordTransferAudit } from "@/lib/transfer/audit";
import {
  claimTransferSlot,
  createTransferJob,
  findRunningTransfer,
  recoverStaleTransfers,
  releaseTransferSlot,
  toJobView,
  getTransferJob,
  updateTransferJob,
  type TransferJobView,
} from "@/lib/transfer/jobs";
import { requireTransferRole } from "@/lib/transfer/permissions";
import type { ImportOptions, ImportPlan } from "@/lib/transfer/format";
import { applyImportPlan, type ImportActor } from "./apply";
import { buildImportPlan } from "./plan";
import { deleteImportSource, importSourcePath, readImportSource, sweepImportSources } from "./source";

export type ImportPreview = {
  sourceId: string;
  kind: ImportPlan["kind"];
  fileName: string;
  bytes: number;
  fingerprint: string;
  workspaceName: string;
  workspaceKey: string | null;
  counts: ImportPlan["counts"];
  conflicts: ImportPlan["conflicts"];
  unmapped: ImportPlan["unmapped"];
  warnings: ImportPlan["warnings"];
  ignored: ImportPlan["ignored"];
  duplicateWorkspaceId: string | null;
  attachmentCapBytes: number;
};

function previewOf(sourceId: string, plan: ImportPlan): ImportPreview {
  return {
    sourceId,
    kind: plan.kind,
    fileName: plan.fileName,
    bytes: plan.bytes,
    fingerprint: plan.fingerprint,
    workspaceName: plan.workspaceName,
    workspaceKey: plan.workspaceKey,
    counts: plan.counts,
    conflicts: plan.conflicts,
    unmapped: plan.unmapped,
    warnings: plan.warnings,
    ignored: plan.ignored,
    duplicateWorkspaceId: plan.duplicateWorkspaceId,
    attachmentCapBytes: plan.attachmentCapBytes,
  };
}

/**
 * Parses the staged source and returns everything the preview screen shows. Nothing is
 * written: project/task/document rows only appear after `startWorkspaceImport`.
 */
export async function previewWorkspaceImport(input: {
  workspaceId: string;
  sourceId: string;
  options?: ImportOptions;
}): Promise<ImportPreview> {
  const { user } = await requireTransferRole(input.workspaceId);
  await sweepImportSources();
  const source = await readImportSource(input.sourceId, input.workspaceId, user.id);
  const plan = await buildImportPlan({
    sourcePath: importSourcePath(source.id),
    fileName: source.fileName,
    bytes: source.bytes,
    fingerprint: source.fingerprint,
    options: input.options,
    actorId: user.id,
  });
  return previewOf(source.id, plan);
}

export async function startWorkspaceImport(input: {
  workspaceId: string;
  sourceId: string;
  options?: ImportOptions;
}): Promise<TransferJobView> {
  const { user, workspace } = await requireTransferRole(input.workspaceId);
  await recoverStaleTransfers();
  const source = await readImportSource(input.sourceId, input.workspaceId, user.id);
  const plan = await buildImportPlan({
    sourcePath: importSourcePath(source.id),
    fileName: source.fileName,
    bytes: source.bytes,
    fingerprint: source.fingerprint,
    options: input.options,
    actorId: user.id,
  });
  if (plan.duplicateWorkspaceId) {
    const job = await createTransferJob({
      kind: "import",
      workspaceId: input.workspaceId,
      createdBy: user.id,
      fingerprint: plan.fingerprint,
      summary: {
        duplicate: true,
        targetWorkspaceId: plan.duplicateWorkspaceId,
        workspaceName: plan.workspaceName,
        fileName: source.fileName,
        counts: plan.counts,
      },
    });
    await updateTransferJob(
      job.id,
      {
        status: "done",
        phase: "Already imported",
        progress: 100,
        targetWorkspaceId: plan.duplicateWorkspaceId,
        finishedAt: new Date().toISOString(),
      },
      { force: true }
    );
    await deleteImportSource(source.id);
    return toJobView((await getTransferJob(job.id)) ?? job);
  }
  const running = await findRunningTransfer(input.workspaceId, "import");
  if (running) return toJobView(running);
  if (!claimTransferSlot("import", input.workspaceId)) {
    throw new TacosError("An import is already running for this workspace", 409);
  }
  let job;
  try {
    job = await createTransferJob({
      kind: "import",
      workspaceId: input.workspaceId,
      createdBy: user.id,
      fingerprint: plan.fingerprint,
      summary: {
        sourceId: source.id,
        fileName: source.fileName,
        workspaceName: plan.workspaceName,
        counts: plan.counts,
        fromWorkspace: { id: workspace.id, name: workspace.name },
      },
    });
  } catch (error) {
    releaseTransferSlot("import", input.workspaceId);
    throw error;
  }
  const actor: ImportActor = { id: user.id, username: user.username, displayName: user.displayName };
  void runImportJob({
    jobId: job.id,
    initiatingWorkspaceId: input.workspaceId,
    sourceId: source.id,
    sourceFileName: source.fileName,
    sourceFingerprint: source.fingerprint,
    sourceBytes: source.bytes,
    options: input.options,
    actor,
  });
  return toJobView(job);
}

async function runImportJob(input: {
  jobId: string;
  initiatingWorkspaceId: string;
  sourceId: string;
  sourceFileName: string;
  sourceFingerprint: string;
  sourceBytes: number;
  options?: ImportOptions;
  actor: ImportActor;
}): Promise<void> {
  try {
    await updateTransferJob(
      input.jobId,
      { status: "running", phase: "Reading source", progress: 3 },
      { force: true }
    );
    const plan = await buildImportPlan({
      sourcePath: importSourcePath(input.sourceId),
      fileName: input.sourceFileName,
      bytes: input.sourceBytes,
      fingerprint: input.sourceFingerprint,
      options: input.options,
      actorId: input.actor.id,
    });
    if (plan.duplicateWorkspaceId) {
      await updateTransferJob(
        input.jobId,
        {
          status: "done",
          phase: "Already imported",
          progress: 100,
          summary: {
            duplicate: true,
            targetWorkspaceId: plan.duplicateWorkspaceId,
            workspaceName: plan.workspaceName,
            counts: plan.counts,
          },
          finishedAt: new Date().toISOString(),
        },
        { force: true }
      );
      return;
    }
    const applied = await applyImportPlan({
      plan,
      sourcePath: importSourcePath(input.sourceId),
      actor: input.actor,
      onWorkspaceCreated: (targetWorkspaceId) => {
        void updateTransferJob(input.jobId, { targetWorkspaceId }).catch(() => {});
      },
      onProgress: (phase, progress) => {
        void updateTransferJob(input.jobId, { phase, progress }).catch(() => {});
      },
    });
    const summary = {
      workspace: { id: applied.workspaceId, name: applied.workspaceName, key: applied.workspaceKey },
      targetWorkspaceId: applied.workspaceId,
      workspaceName: applied.workspaceName,
      counts: applied.counts,
      warnings: applied.warnings,
      fileName: input.sourceFileName,
      options: input.options ?? {},
    };
    await updateTransferJob(
      input.jobId,
      {
        status: "done",
        phase: "Done",
        progress: 100,
        targetWorkspaceId: applied.workspaceId,
        finishedAt: new Date().toISOString(),
        summary,
      },
      { force: true }
    );
    await recordTransferAudit({
      workspaceId: applied.workspaceId,
      type: "import_completed",
      actor: { kind: "user", userId: input.actor.id, displayName: input.actor.displayName },
      data: { jobId: input.jobId, fromWorkspaceId: input.initiatingWorkspaceId, counts: applied.counts },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed";
    await updateTransferJob(
      input.jobId,
      {
        status: "failed",
        phase: "Failed",
        error: `${message} Nothing was imported; the temporary workspace was removed.`,
        finishedAt: new Date().toISOString(),
      },
      { force: true }
    );
    await recordTransferAudit({
      workspaceId: input.initiatingWorkspaceId,
      type: "import_failed",
      actor: { kind: "user", userId: input.actor.id, displayName: input.actor.displayName },
      data: { jobId: input.jobId, error: message, fileName: input.sourceFileName },
    }).catch(() => {});
  } finally {
    await deleteImportSource(input.sourceId).catch(() => {});
    releaseTransferSlot("import", input.initiatingWorkspaceId);
  }
}

export async function getImportJob(workspaceId: string, jobId: string): Promise<TransferJobView> {
  await requireTransferRole(workspaceId);
  const job = await getTransferJob(jobId);
  if (!job || job.kind !== "import" || job.workspaceId !== workspaceId) {
    throw new TacosError("Import not found", 404);
  }
  return toJobView(job);
}
