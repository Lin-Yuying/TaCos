import fs from "node:fs";
import { TacosError } from "@/lib/tacos-error";
import { requireTransferRole } from "@/lib/transfer/permissions";
import { recordTransferAudit } from "@/lib/transfer/audit";
import {
  claimTransferSlot,
  createTransferJob,
  findRunningTransfer,
  recoverStaleTransfers,
  releaseTransferSlot,
  toJobView,
  updateTransferJob,
  type TransferJobView,
} from "@/lib/transfer/jobs";
import { exportFileName, exportOutputPath, writeWorkspaceExport } from "./workspace";

/**
 * Starts the export in this process and returns the progress row immediately. The
 * Settings page polls `GET /api/export/workspace/[jobId]`; the archive appears under
 * <data>/exports and is served through a signed, short-lived URL.
 */
export async function startWorkspaceExport(
  workspaceId: string,
  options: { includeAttachments?: boolean } = {}
): Promise<TransferJobView> {
  const includeAttachments = options.includeAttachments ?? true;
  const { user, workspace } = await requireTransferRole(workspaceId);
  await recoverStaleTransfers();
  const running = await findRunningTransfer(workspaceId, "export");
  if (running) return toJobView(running);
  if (!claimTransferSlot("export", workspaceId)) {
    throw new TacosError("An export is already running for this workspace", 409);
  }
  let job;
  try {
    job = await createTransferJob({
      kind: "export",
      workspaceId,
      createdBy: user.id,
      summary: { includeAttachments, workspace: { id: workspace.id, name: workspace.name, key: workspace.key } },
    });
  } catch (error) {
    releaseTransferSlot("export", workspaceId);
    throw error;
  }
  const output = exportOutputPath(job.id);
  const fileName = exportFileName(workspace);
  void runExportJob(job.id, workspaceId, output, fileName, includeAttachments, {
    id: user.id,
    displayName: user.displayName,
  });
  return toJobView(job);
}

async function runExportJob(
  jobId: string,
  workspaceId: string,
  output: string,
  fileName: string,
  includeAttachments: boolean,
  actor: { id: string; displayName: string }
): Promise<void> {
  try {
    await updateTransferJob(
      jobId,
      { status: "running", phase: "Collecting workspace", progress: 1 },
      { force: true }
    );
    await recordTransferAudit({
      workspaceId,
      type: "export_started",
      actor: { kind: "user", userId: actor.id, displayName: actor.displayName },
      data: { jobId },
    });
    const result = await writeWorkspaceExport(workspaceId, output, {
      includeAttachments,
      onProgress: (phase, progress) => {
        void updateTransferJob(jobId, { phase, progress }).catch(() => {});
      },
    });
    const stat = await fs.promises.stat(output);
    await updateTransferJob(
      jobId,
      {
        status: "done",
        phase: "Done",
        progress: 100,
        artifactPath: output,
        artifactName: fileName,
        artifactBytes: stat.size,
        finishedAt: new Date().toISOString(),
        summary: {
          counts: result.counts,
          attachments: result.attachments,
          entries: result.entries,
          workspace: result.workspace,
          fileName,
        },
      },
      { force: true }
    );
    await recordTransferAudit({
      workspaceId,
      type: "export_completed",
      actor: { kind: "user", userId: actor.id, displayName: actor.displayName },
      data: {
        jobId,
        fileName,
        bytes: stat.size,
        counts: result.counts,
        attachments: result.attachments,
      },
    });
  } catch (error) {
    await fs.promises.rm(output, { force: true }).catch(() => {});
    const message = error instanceof Error ? error.message : "Export failed";
    await updateTransferJob(
      jobId,
      { status: "failed", phase: "Failed", error: message, finishedAt: new Date().toISOString() },
      { force: true }
    );
    await recordTransferAudit({
      workspaceId,
      type: "export_failed",
      actor: { kind: "user", userId: actor.id, displayName: actor.displayName },
      data: { jobId, error: message },
    }).catch(() => {});
  } finally {
    releaseTransferSlot("export", workspaceId);
  }
}
