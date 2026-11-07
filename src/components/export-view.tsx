"use client";

import { SETTINGS_PAGE, SETTINGS_SCROLL, SETTINGS_TITLE } from "@/lib/page-chrome";
import { useEffect, useState } from "react";
import { useT } from "./i18n-context";
import { timeAgo } from "@/lib/format";

export type TransferJobView = {
  id: string;
  kind: "export" | "import";
  status: "queued" | "running" | "done" | "failed";
  phase: string;
  progress: number;
  summary: Record<string, unknown>;
  error: string | null;
  artifactName: string | null;
  artifactBytes: number | null;
  targetWorkspaceId: string | null;
  downloadUrl: string | null;
  createdAt: string;
  finishedAt: string | null;
};

const RUNNING = new Set(["queued", "running"]);

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function jobCounts(job: TransferJobView): Record<string, number> {
  const counts = job.summary.counts;
  return counts && typeof counts === "object" && !Array.isArray(counts)
    ? (counts as Record<string, number>)
    : {};
}

export function ExportView({
  workspaceId,
  workspaceName,
  initialJobs,
  capBytes,
}: {
  workspaceId: string;
  workspaceName: string;
  initialJobs: TransferJobView[];
  capBytes: number;
}) {
  const t = useT();
  const [jobs, setJobs] = useState(initialJobs);
  const [job, setJob] = useState<TransferJobView | null>(
    initialJobs.find((entry) => RUNNING.has(entry.status)) ?? null
  );
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeJobId = job && RUNNING.has(job.status) ? job.id : null;
  useEffect(() => {
    if (!activeJobId) return;
    const jobId = activeJobId;
    const timer = setInterval(() => {
      void fetch(`/api/export/workspace/${jobId}`, { cache: "no-store" })
        .then(async (response) => {
          const data = (await response.json()) as TransferJobView & { error?: string };
          if (!response.ok) throw new Error(data.error ?? "Could not read export progress.");
          setJob(data);
          setJobs((previous) => [data, ...previous.filter((entry) => entry.id !== data.id)]);
          if (!RUNNING.has(data.status)) setBusy(false);
        })
        .catch((fetchError) => {
          setError(fetchError instanceof Error ? fetchError.message : "Could not read export progress.");
          setBusy(false);
        });
    }, 1000);
    return () => clearInterval(timer);
  }, [activeJobId]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/export/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, includeAttachments }),
      });
      const data = (await response.json()) as TransferJobView & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not start the export.");
      setJob(data);
      setJobs((previous) => [data, ...previous.filter((entry) => entry.id !== data.id)]);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start the export.");
      setBusy(false);
    }
  }

  const counts = job ? jobCounts(job) : {};
  const omitted = job?.summary.attachments
    ? (job.summary.attachments as { omittedCount?: number }).omittedCount ?? 0
    : 0;
  return (
    <div className={SETTINGS_SCROLL} data-testid="export-page">
      <div className={`max-w-[640px] ${SETTINGS_PAGE}`}>
        <h1 className={SETTINGS_TITLE}>{t("Export workspace")}</h1>

        <section className="space-y-3 rounded-lg border border-border p-4">
          <p className="text-body text-muted">
            {t(
              "Download every task, document, comment and attachment in {name} as one ZIP. The archive is portable: an owner can import it into a new workspace on another TaCos server.",
              { name: workspaceName }
            )}
          </p>
          <label className="flex items-start gap-2 text-body">
            <input
              type="checkbox"
              checked={includeAttachments}
              disabled={busy}
              onChange={(event) => setIncludeAttachments(event.target.checked)}
              data-testid="export-attachments"
              className="mt-1"
            />
            <span>
              {t("Include attachments (up to {size})", { size: megabytes(capBytes) })}
              <span className="block text-small text-faint">
                {t("Files over the cap are listed in the archive manifest and skipped. No passwords, API key hashes or model keys are ever included.")}
              </span>
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || Boolean(job && RUNNING.has(job.status))}
              onClick={() => void start()}
              data-testid="export-start"
              className="rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white transition-opacity disabled:opacity-40"
            >
              {job && RUNNING.has(job.status) ? t("Exporting…") : t("Start export")}
            </button>
            {job && RUNNING.has(job.status) && (
              <span className="text-small text-muted">{t("You can leave this page; the export keeps running.")}</span>
            )}
          </div>
          {error && (
            <p role="alert" data-testid="export-error" className="text-small text-danger">
              {error}
            </p>
          )}
          {job && (
            <div className="space-y-2 rounded-md border border-border p-3" data-testid="export-progress">
              <div className="flex items-baseline justify-between gap-3 text-small">
                <span data-testid="export-phase">{t(job.phase || "Queued")}</span>
                <span className="font-variant-numeric tabular-nums text-muted">{job.progress}%</span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={job.progress}
                aria-label={t("Export progress")}
                className="h-1.5 overflow-hidden rounded-full bg-elevated"
              >
                <div
                  className={`h-full rounded-full ${job.status === "failed" ? "bg-danger" : "bg-accent"}`}
                  style={{ width: `${job.progress}%` }}
                />
              </div>
              {job.status === "done" && (
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href={job.downloadUrl ?? "#"}
                    data-testid="export-download"
                    className="rounded-md border border-border px-3 py-1.5 text-body font-medium text-accent"
                  >
                    {t("Download export")}
                  </a>
                  <span className="text-small text-muted">
                    {t("{tasks} tasks · {documents} documents · {attachments} attachments", {
                      tasks: counts.tasks ?? 0,
                      documents: counts.documents ?? 0,
                      attachments: counts.attachments ?? 0,
                    })}
                  </span>
                </div>
              )}
              {job.status === "done" && (
                <p className="text-small text-faint">
                  {t("The download link works for 15 minutes. Start another export to get a fresh one.")}
                </p>
              )}
              {omitted > 0 && (
                <p className="text-small text-muted">
                  {t("{count} attachments were left out of the archive.", { count: omitted })}
                </p>
              )}
              {job.status === "failed" && job.error && (
                <p role="alert" data-testid="export-error" className="text-small text-danger">
                  {job.error}
                </p>
              )}
            </div>
          )}
        </section>

        <section className="space-y-2" data-testid="export-history">
          <h2 className="text-title font-semibold">{t("Recent exports")}</h2>
          {jobs.length === 0 ? (
            <p className="text-small text-muted">{t("No exports yet.")}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {jobs.map((entry) => (
                <li key={entry.id} data-testid="export-job-row" className="flex flex-wrap items-center gap-3 px-3 py-2 text-small">
                  <span className="min-w-0 flex-1 truncate font-mono text-caption text-muted">
                    {entry.artifactName ?? entry.id.slice(0, 8)}
                  </span>
                  <span className="tabular-nums">{entry.progress}%</span>
                  <span className={entry.status === "failed" ? "text-danger" : "text-muted"}>
                    {t(entry.status === "done" ? "Done" : entry.status === "failed" ? "Failed" : entry.phase || "Queued")}
                  </span>
                  <span className="text-faint">{timeAgo(entry.createdAt)}</span>
                  {entry.downloadUrl && (
                    <a href={entry.downloadUrl} className="text-accent underline">
                      {t("Download")}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
