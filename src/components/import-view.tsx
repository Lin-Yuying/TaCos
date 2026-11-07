"use client";

import Link from "next/link";
import { SETTINGS_PAGE, SETTINGS_SCROLL, SETTINGS_TITLE } from "@/lib/page-chrome";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./i18n-context";
import { fileSizeLabel, timeAgo } from "@/lib/format";

type ImportCounts = {
  members: number;
  matchedMembers: number;
  projects: number;
  labels: number;
  taskFields: number;
  tasks: number;
  comments: number;
  documents: number;
  pageComments: number;
  attachments: number;
  attachmentBytes: number;
};

type Preview = {
  sourceId: string;
  kind: "tacos-export" | "markdown" | "csv";
  fileName: string;
  bytes: number;
  workspaceName: string;
  counts: ImportCounts;
  conflicts: Array<{ kind: string; message: string; count: number; samples: string[] }>;
  unmapped: Array<{ source: string; field: string; count: number }>;
  warnings: string[];
  ignored: Array<{ section: string; count: number }>;
  duplicateWorkspaceId: string | null;
  attachmentCapBytes: number;
};

type Job = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  phase: string;
  progress: number;
  error: string | null;
  summary: Record<string, unknown>;
  targetWorkspaceId: string | null;
  createdAt: string;
};

const RUNNING = new Set(["queued", "running"]);
const ATTENTION_ROW = "flex items-start gap-2 px-3 py-2";
const ATTENTION_BADGE = "shrink-0 rounded-full border border-border px-1.5 text-caption text-muted";

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function summaryWorkspace(job: Job | null): { id: string; name: string; key: string } | null {
  const value = job?.summary.workspace;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as { id: string; name: string; key: string })
    : null;
}

export function ImportView({
  workspaceId,
  initialJobs,
  capBytes,
}: {
  workspaceId: string;
  initialJobs: Job[];
  capBytes: number;
}) {
  const t = useT();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [folderFiles, setFolderFiles] = useState<Array<{ file: File; path: string }>>([]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [job, setJob] = useState<Job | null>(
    initialJobs.find((entry) => RUNNING.has(entry.status)) ?? null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const successful = useRef(false);

  const activeJobId = job && RUNNING.has(job.status) ? job.id : null;
  useEffect(() => {
    if (!activeJobId) return;
    const jobId = activeJobId;
    const timer = setInterval(() => {
      void fetch(`/api/internal/${workspaceId}/import/${jobId}`, { cache: "no-store" })
        .then(async (response) => {
          const data = (await response.json()) as Job & { error?: string };
          if (!response.ok) throw new Error(data.error ?? "Could not read import progress.");
          setJob(data);
          if (!RUNNING.has(data.status)) {
            setBusy(false);
            if (data.status === "done" && !successful.current) {
              successful.current = true;
              router.refresh();
            }
          }
        })
        .catch((fetchError) => {
          setError(fetchError instanceof Error ? fetchError.message : "Could not read import progress.");
          setBusy(false);
        });
    }, 1000);
    return () => clearInterval(timer);
  }, [activeJobId, workspaceId, router]);

  function reset() {
    setPreview(null);
    setJob(null);
    setError(null);
    setBusy(false);
    successful.current = false;
  }

  function chooseFile(files: FileList | null) {
    const chosen = files?.[0] ?? null;
    setFolderFiles([]);
    setFile(chosen);
    reset();
  }

  async function previewImport() {
    if (!file && folderFiles.length === 0) {
      setError(t("Choose a ZIP, CSV or folder first."));
      return;
    }
    setBusy(true);
    setError(null);
    setJob(null);
    setPreview(null);
    try {
      const form = new FormData();
      if (folderFiles.length > 0) {
        for (const entry of folderFiles) {
          form.append("files", entry.file);
          form.append("paths", entry.path);
        }
      } else if (file) {
        form.append("files", file);
      }
      form.append("includeAttachments", String(includeAttachments));
      if (workspaceName.trim()) form.append("workspaceName", workspaceName.trim());
      const response = await fetch(`/api/internal/${workspaceId}/import`, {
        method: "POST",
        body: form,
      });
      const data = (await response.json()) as Preview & { error?: string; hint?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not read that import.");
      setPreview(data);
      if (!workspaceName.trim()) setWorkspaceName(data.workspaceName);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Could not read that import.");
    } finally {
      setBusy(false);
    }
  }

  async function applyImport() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/internal/${workspaceId}/import/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: preview.sourceId,
          workspaceName: workspaceName.trim() || preview.workspaceName,
          includeAttachments,
        }),
      });
      const data = (await response.json()) as Job & { error?: string; hint?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not start the import.");
      setJob(data);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "Could not start the import.");
      setBusy(false);
    }
  }

  const counts = preview?.counts;
  const target = summaryWorkspace(job);
  return (
    <div className={SETTINGS_SCROLL} data-testid="import-page">
      <div className={`max-w-[640px] ${SETTINGS_PAGE}`}>
        {!preview && (
          <>
            <h1 className={SETTINGS_TITLE}>{t("Import workspace")}</h1>
            <p className="text-small text-faint">
              {t("The import always creates a new workspace; nothing in the current workspace changes.")}
            </p>
            <section className="space-y-2">
              <h2 className="text-body font-semibold">{t("Choose a source")}</h2>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-body">
              {t("Choose ZIP or CSV")}
              <input
                type="file"
                accept=".zip,.csv,text/csv,application/zip"
                className="sr-only"
                data-testid="import-file"
                onChange={(event) => chooseFile(event.target.files)}
              />
            </label>
            <button
              type="button"
              onClick={() => folderInput.current?.click()}
              data-testid="import-folder"
              className="rounded-md border border-border px-3 py-1.5 text-body"
            >
              {t("Choose Markdown folder")}
            </button>
            <input
              ref={folderInput}
              type="file"
              multiple
              className="hidden"
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              data-testid="import-folder-input"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])].map((entry) => ({
                  file: entry,
                  path:
                    (entry as File & { webkitRelativePath?: string }).webkitRelativePath || entry.name,
                }));
                setFile(null);
                setFolderFiles(files);
                reset();
              }}
            />
          </div>
          <p className="text-small text-muted" data-testid="import-selection">
            {folderFiles.length > 0
              ? t("{count} files selected", { count: folderFiles.length })
              : file
                ? `${file.name} (${mb(file.size)})`
                : t("No file selected.")}
          </p>
            </section>
            <section className="space-y-3">
          <label className="block text-body">
            <span className="mb-1 block text-small font-medium text-muted">{t("New workspace name")}</span>
            <input
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              maxLength={120}
              placeholder={t("Taken from the file if left empty")}
              data-testid="import-workspace-name"
              className="w-full rounded border border-border bg-bg px-2.5 py-1.5 text-body"
            />
          </label>
          <label className="flex items-center gap-2 text-body">
            <input
              type="checkbox"
              checked={includeAttachments}
              disabled={busy}
              onChange={(event) => {
                setIncludeAttachments(event.target.checked);
                if (preview) setPreview(null);
              }}
              data-testid="import-attachments"
            />
            {t("Include attachments (up to {size})", { size: fileSizeLabel(capBytes) })}
          </label>
          <p className="text-small text-faint">
            {t("Files above the cap stay linked to their original path and are counted as skipped.")}
          </p>
          <button
            type="button"
            onClick={() => void previewImport()}
            disabled={busy || (!file && folderFiles.length === 0)}
            data-testid="import-preview-button"
            className="block rounded-md border border-border px-3 py-1.5 text-body text-text transition-colors hover:bg-elevated disabled:opacity-40"
          >
            {busy && !job ? t("Reading…") : t("Preview import")}
          </button>
          {error && (
            <p role="alert" data-testid="import-error" className="text-small text-danger">
              {error}
            </p>
          )}
            </section>
          </>
        )}

        {preview && (
          <section className="space-y-4" data-testid="import-preview">
            <h1 className={SETTINGS_TITLE}>{t("Import preview")}</h1>
            <p className="text-small text-faint">
              {t("Nothing is written until you confirm. The new workspace stays hidden while it is built.")}
            </p>
            <p className="text-small text-muted">
              {preview.fileName} · {mb(preview.bytes)} · {t(preview.kind === "tacos-export" ? "TaCos export" : preview.kind === "csv" ? "Task CSV" : "Markdown")}
            </p>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["projects", t("Projects"), counts?.projects ?? 0],
                ["tasks", t("Tasks"), counts?.tasks ?? 0],
                ["documents", t("Documents"), counts?.documents ?? 0],
                ["comments", t("Comments"), counts?.comments ?? 0],
                ["attachments", t("Attachments"), counts?.attachments ?? 0],
                ["labels", t("Labels"), counts?.labels ?? 0],
                ["fields", t("Task fields"), counts?.taskFields ?? 0],
                ["members-matched", t("Matched members"), `${counts?.matchedMembers ?? 0} / ${counts?.members ?? 0}`],
              ].map(([key, label, value]) => (
                <div key={String(key)} className="rounded-lg border border-border px-3 py-2">
                  <dd className="text-lead font-semibold tabular-nums" data-testid={`import-count-${key}`}>
                    {value}
                  </dd>
                  <dt className="text-small text-faint">{label}</dt>
                </div>
              ))}
            </dl>
            {preview.duplicateWorkspaceId && (
              <div data-testid="import-duplicate" className="rounded-md border border-border bg-elevated p-3 text-body">
                {t("This exact import already created a workspace.")}{" "}
                <Link className="text-accent underline" href={`/${preview.duplicateWorkspaceId}`}>
                  {t("Open it")}
                </Link>
              </div>
            )}
            {(preview.conflicts.length > 0 || preview.unmapped.length > 0 || preview.warnings.length > 0 || preview.ignored.length > 0) && (
              <div className="space-y-2">
                <h2 className="text-body font-semibold">{t("Needs attention")}</h2>
                <ul className="divide-y divide-border rounded-lg border border-border text-small">
                  {preview.conflicts.map((conflict, index) => (
                    <li key={`${conflict.kind}-${index}`} data-testid="import-conflicts" className={ATTENTION_ROW}>
                      <span className={ATTENTION_BADGE}>{t("Conflict")}</span>
                      <span className="min-w-0 flex-1">
                        {conflict.message} <span className="tabular-nums text-muted">× {conflict.count}</span>
                        {conflict.samples.length > 0 && (
                          <span className="block truncate text-faint">{conflict.samples.join(", ")}</span>
                        )}
                      </span>
                    </li>
                  ))}
                  {preview.unmapped.map((field, index) => (
                    <li key={`${field.source}-${field.field}-${index}`} data-testid="import-unmapped" className={ATTENTION_ROW}>
                      <span className={ATTENTION_BADGE}>{t("Unmapped field")}</span>
                      <span className="min-w-0 flex-1">
                        {t("“{field}” won't be imported", { field: field.field })}
                        <span className="text-faint"> · {field.source} · <span className="tabular-nums">{field.count}</span></span>
                      </span>
                    </li>
                  ))}
                  {preview.warnings.map((warning, index) => (
                    <li key={index} data-testid="import-warnings" className={ATTENTION_ROW}>
                      <span className={ATTENTION_BADGE}>{t("Warning")}</span>
                      <span className="min-w-0 flex-1">{warning}</span>
                    </li>
                  ))}
                  {preview.ignored.map((entry) => (
                    <li key={entry.section} data-testid="import-ignored" className={ATTENTION_ROW}>
                      <span className={ATTENTION_BADGE}>{t("Not imported")}</span>
                      <span className="min-w-0 flex-1">
                        {entry.section}: <span className="tabular-nums">{entry.count}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void applyImport()}
                disabled={busy || Boolean(preview.duplicateWorkspaceId)}
                data-testid="import-confirm"
                className="rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white disabled:opacity-40"
              >
                {t("Import into a new workspace")}
              </button>
              <button
                type="button"
                onClick={() => {
                  reset();
                  setWorkspaceName("");
                }}
                disabled={busy}
                className="rounded-md border border-border px-3 py-1.5 text-body"
              >
                {t("Choose another file")}
              </button>
            </div>
          </section>
        )}

        {job && (
          <section className="space-y-2 rounded-lg border border-border p-3" data-testid="import-progress">
            <div className="flex items-baseline justify-between gap-3 text-small">
              <span data-testid="import-phase">{t(job.phase || "Queued")}</span>
              <span className="font-variant-numeric tabular-nums text-muted">{job.progress}%</span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={job.progress}
              aria-label={t("Import progress")}
              className="h-1.5 overflow-hidden rounded-full bg-elevated"
            >
              <div
                className={`h-full rounded-full ${job.status === "failed" ? "bg-danger" : "bg-accent"}`}
                style={{ width: `${job.progress}%` }}
              />
            </div>
            {job.status === "done" && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-body">{t("The new workspace is ready.")}</p>
                <Link
                  href={`/${job.targetWorkspaceId ?? target?.id ?? ""}`}
                  data-testid="import-result-link"
                  className="rounded-md border border-border px-3 py-1.5 text-body font-medium text-accent"
                >
                  {t("Open workspace")}
                </Link>
              </div>
            )}
            {job.status === "failed" && (
              <p role="alert" data-testid="import-error" className="text-small text-danger">
                {job.error ?? t("The import failed. No workspace was created.")}
              </p>
            )}
          </section>
        )}

        {initialJobs.length > 0 && (
          <section className="space-y-2" data-testid="import-history">
            <h2 className="text-body font-semibold">{t("Recent imports")}</h2>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {initialJobs.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-small">
                  <span className="min-w-0 flex-1 truncate">
                    {String((entry.summary.workspaceName as string | undefined) ?? entry.id.slice(0, 8))}
                  </span>
                  <span className={entry.status === "failed" ? "text-danger" : "text-muted"}>
                    {t(entry.status === "done" ? "Done" : entry.status === "failed" ? "Failed" : "Running")}
                  </span>
                  <span className="text-faint">{timeAgo(entry.createdAt)}</span>
                  {entry.targetWorkspaceId && (
                    <Link className="text-accent underline" href={`/${entry.targetWorkspaceId}`}>
                      {t("Open")}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
