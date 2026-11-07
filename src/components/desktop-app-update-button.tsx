"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, RotateCcw, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";

/**
 * H-DESKTOP-UPDATE-03: top-bar pill for the desktop app binary update.
 * Desktop only — hidden on the web build (no window.tacosDesktop.appUpdate) — and shown
 * only when a newer version is known. Fixed Simplified Chinese labels: this is a
 * packaged-desktop affordance, not web UI copy.
 * Distinct from Settings › Harness CLI update control.
 */

export type AppUpdateStatus = {
  enabled: boolean;
  state: string;
  currentVersion: string;
  availableVersion: string | null;
  progress: number | null;
  error: string | null;
  stage?: string | null;
  cancelable?: boolean;
  // U-12: stable channel only; null unsigned means "not known here" (web build).
  channel?: "stable" | string;
  releaseNotes?: string | null;
  releaseDate?: string | null;
  unsigned?: boolean | null;
};

export type AppUpdateApi = {
  cancel?: () => Promise<{ ok: boolean }>;
  getStatus: () => Promise<AppUpdateStatus>;
  check: () => Promise<{ ok: boolean; error?: string; status?: AppUpdateStatus }>;
  download: () => Promise<{ ok: boolean; error?: string; status?: AppUpdateStatus }>;
  install: () => Promise<{ ok: boolean; error?: string; status?: AppUpdateStatus }>;
  // The in-app pill confirms by itself; this path skips the native install dialog.
  restart?: () => Promise<{ ok: boolean; error?: string; degraded?: boolean; busy?: boolean; status?: AppUpdateStatus }>;
  onStatus: (handler: (status: AppUpdateStatus) => void) => () => void;
};

// Fixed Simplified Chinese labels (backlog: Chinese copy only).
const COPY = {
  available: "新版本",
  downloading: "正在下载",
  unpacking: "正在解压更新…",
  verifying: "正在检查签名…",
  ready: "安装并重启",
  preparing: "正在准备重启…",
  error: "更新失败",
  cancel: "取消准备更新",
  busyTitle: "仍有进行中的任务",
  busyBody: "更新将停止进行中的任务并重启应用，是否继续？",
  busyConfirm: "停止任务并更新",
  busyCancel: "稍后更新",
} as const;

const PILL =
  "group relative flex h-7 shrink-0 items-center rounded-full border border-update-border bg-update-bg text-small font-medium text-update-text transition-colors";
const LABEL =
  "flex h-full items-center gap-1.5 rounded-full pl-2.5 pr-2.5 transition-colors hover:bg-update-bg-hover disabled:cursor-default disabled:hover:bg-transparent";

function labelFor(status: AppUpdateStatus | null, preparing: boolean): string {
  if (preparing) return COPY.preparing;
  if (!status) return COPY.available;
  if (status.state === "downloading") {
    if (status.stage === "unpacking") return COPY.unpacking;
    if (status.stage === "verifying") return COPY.verifying;
    const percent = typeof status.progress === "number" ? Math.round(status.progress) : null;
    return percent == null ? COPY.downloading : `${COPY.downloading} ${percent}%`;
  }
  if (status.state === "downloaded") return COPY.ready;
  if (status.state === "error") return COPY.error;
  return COPY.available;
}

// The hover/focus tooltip carries the version, the way the desktop reference does:
// "安装并重启：2.3.1".
function tooltipFor(status: AppUpdateStatus | null): string {
  const version = status?.availableVersion;
  const withVersion = (label: string) => (version ? `${label}：${version}` : label);
  if (!status) return COPY.available;
  if (status.state === "downloaded") return withVersion(COPY.ready);
  if (status.state === "available") return withVersion(COPY.available);
  if (status.state === "downloading") return withVersion(`正在下载更新`);
  if (status.state === "error") return status.error ? `${COPY.error}：${status.error}` : COPY.error;
  return COPY.available;
}

// Restarting ends a running Agent turn, so the pill asks the server before it does.
export async function agentIsWorking(): Promise<boolean> {
  try {
    const response = await fetch("/api/agent/busy", {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { busy?: boolean };
    return body.busy === true;
  } catch {
    return false;
  }
}

export function DesktopAppUpdateButton() {
  const [api, setApi] = useState<AppUpdateApi | null>(null);
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [clicking, setClicking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const preparingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const bridge = window.tacosDesktop?.appUpdate;
    if (!bridge?.getStatus || !bridge.onStatus) return;
    let cancelled = false;
    const off = bridge.onStatus((next) => {
      if (cancelled) return;
      setApi(bridge);
      setStatus(next);
    });
    void bridge.getStatus().then((next) => {
      if (cancelled) return;
      setApi(bridge);
      setStatus(next);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(
    () => () => {
      if (preparingTimer.current) clearTimeout(preparingTimer.current);
    },
    [],
  );

  // The renderer confirms before restarting, so it uses the dialog-free restart path.
  // A build that cannot replace itself opens the GitHub download page and keeps running.
  const restart = useCallback(async () => {
    setConfirmOpen(false);
    if (!api) return;
    setPreparing(true);
    const run: () => Promise<{ ok: boolean; degraded?: boolean; busy?: boolean }> =
      api.restart ?? api.install;
    try {
      const result = await run();
      if (!result?.ok || result.degraded) {
        setPreparing(false);
        // The main process checks the Agent again; ask the person once more when it
        // could not prove that nothing is running.
        if (result?.busy) setConfirmOpen(true);
        return;
      }
      // quitAndInstall replaces this window; if it does not, the pill must not stay stuck.
      preparingTimer.current = setTimeout(() => setPreparing(false), 15000);
    } catch {
      setPreparing(false);
    }
  }, [api]);

  const onClick = useCallback(async () => {
    if (!api || clicking || preparing) return;
    if (status?.state === "downloaded") {
      setClicking(true);
      try {
        // An older shell has no dialog-free restart; its install() runs the native
        // prompt, so do not add the in-app confirmation on top of it.
        if (!api.restart) await api.install();
        else if (await agentIsWorking()) setConfirmOpen(true);
        else await restart();
      } finally {
        setClicking(false);
      }
      return;
    }
    if (status?.state === "error") {
      setClicking(true);
      try {
        // After a failed download the check starts it over.
        await api.check();
      } finally {
        setClicking(false);
      }
      return;
    }
    if (status?.state === "available") {
      setClicking(true);
      try {
        await api.install();
      } finally {
        setClicking(false);
      }
    }
  }, [api, clicking, preparing, restart, status?.state]);

  if (!api) return null;

  // Nothing to do unless a newer version exists. The checks run on their own, and the
  // menu can still ask for one.
  const pending =
    status?.state === "available" ||
    status?.state === "downloading" ||
    status?.state === "downloaded" ||
    (status?.state === "error" && Boolean(status.availableVersion));
  if (!pending) return null;

  const label = labelFor(status, preparing);
  const title = preparing ? COPY.preparing : tooltipFor(status);
  const unpacking = status?.state === "downloading" && Boolean(status?.stage);
  const Icon = preparing || unpacking ? Loader2 : status?.state === "error" ? RotateCcw : Download;
  const spinning = preparing || unpacking;
  const pulsing = status?.state === "downloading" && !unpacking;
  const cancelable = status?.state === "downloading" && Boolean(status.cancelable) && Boolean(api.cancel);

  return (
    <>
      <div className="ml-1 flex shrink-0 items-center">
        <div className={PILL}>
          <button
            type="button"
            onClick={() => void onClick()}
            title={title}
            aria-label={title}
            disabled={clicking || preparing || status?.state === "downloading"}
            data-desktop-app-update="true"
            className={`${LABEL} ${cancelable ? "pr-1" : ""}`}
          >
            <Icon
              size={14}
              className={spinning ? "animate-spin" : pulsing ? "animate-pulse" : undefined}
            />
            <span className="whitespace-nowrap tabular-nums">{label}</span>
          </button>
          {cancelable ? (
            <button
              type="button"
              onClick={() => void api.cancel?.()}
              title={COPY.cancel}
              aria-label={COPY.cancel}
              className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-update-text/70 transition-colors hover:bg-update-bg-hover hover:text-update-text"
            >
              <X size={11} />
            </button>
          ) : null}
          <span
            role="tooltip"
            className="pointer-events-none absolute top-[calc(100%+8px)] left-1/2 z-[80] -translate-x-1/2 whitespace-nowrap rounded-md bg-text px-2 py-1 text-small font-normal text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          >
            {title}
          </span>
        </div>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={COPY.busyTitle}
        className="max-w-[420px]"
      >
        <h2 className="px-4 pb-2.5 pt-3.5 text-lead font-semibold text-text">{COPY.busyTitle}</h2>
        <div className="space-y-2.5 px-4 pb-3">
          <p className="text-body text-muted">{COPY.busyBody}</p>
          {status?.unsigned === true && (
            <p className="rounded-md border border-update-border bg-update-bg px-2 py-1 text-small text-update-text">
              未签名版本：更新会打开 GitHub 下载页，由你手动安装。
            </p>
          )}
          {status?.releaseNotes && (
            <p className="max-h-24 overflow-auto whitespace-pre-wrap text-small text-muted">
              {status.releaseNotes.slice(0, 600)}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small border border-border transition-colors bg-bg text-text hover:bg-active"
          >
            {COPY.busyCancel}
          </button>
          <button
            type="button"
            onClick={() => void restart()}
            className="rounded-md bg-danger px-3 py-1.5 text-small font-medium text-white transition-opacity hover:opacity-90"
          >
            {COPY.busyConfirm}
          </button>
        </div>
      </Modal>
    </>
  );
}

// Exported for harness checks (must stay distinct from harness CLI copy).
export const DESKTOP_APP_UPDATE_COPY = COPY;
