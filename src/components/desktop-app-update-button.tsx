"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, RotateCcw } from "lucide-react";

/**
 * H-DESKTOP-UPDATE-03: sidebar control for the desktop app binary update.
 * Chinese copy only. Hidden on the web build (no window.tacosDesktop.appUpdate).
 * Distinct from Settings › Harness CLI update control.
 */

type AppUpdateStatus = {
  enabled: boolean;
  state: string;
  currentVersion: string;
  availableVersion: string | null;
  progress: number | null;
  error: string | null;
};

export type AppUpdateApi = {
  getStatus: () => Promise<AppUpdateStatus>;
  check: () => Promise<{ ok: boolean; error?: string; status?: AppUpdateStatus }>;
  download: () => Promise<{ ok: boolean; error?: string; status?: AppUpdateStatus }>;
  install: () => Promise<{ ok: boolean; error?: string; status?: AppUpdateStatus }>;
  onStatus: (handler: (status: AppUpdateStatus) => void) => () => void;
};

// Fixed Simplified Chinese labels (backlog: Chinese copy only).
const COPY = {
  check: "检查应用更新",
  checking: "正在检查…",
  downloading: "正在下载…",
  available: "发现新版本",
  ready: "重启以安装更新",
  error: "应用更新失败",
  idleHint: "检查应用更新",
} as const;

function labelFor(status: AppUpdateStatus | null, busy: boolean): string {
  if (!status) return COPY.check;
  if (busy || status.state === "checking") return COPY.checking;
  if (status.state === "downloading") {
    const p = typeof status.progress === "number" ? Math.round(status.progress) : null;
    return p != null ? `${COPY.downloading} ${p}%` : COPY.downloading;
  }
  if (status.state === "downloaded") return COPY.ready;
  if (status.state === "available") return COPY.available;
  if (status.state === "error") return COPY.error;
  return COPY.idleHint;
}

export function DesktopAppUpdateButton({ compact }: { compact?: boolean }) {
  const [api, setApi] = useState<AppUpdateApi | null>(null);
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const bridge = window.tacosDesktop?.appUpdate;
    if (!bridge?.getStatus || !bridge.onStatus) return;
    setApi(bridge);
    let cancelled = false;
    void bridge.getStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    const off = bridge.onStatus((s) => setStatus(s));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const onClick = useCallback(async () => {
    if (!api || busy) return;
    setBusy(true);
    try {
      // After a failed download the check starts it over. Otherwise the main process asks
      // about restarting, once the download is finished if it is still running.
      if (status?.state === "error") await api.check();
      else await api.install();
    } finally {
      setBusy(false);
    }
  }, [api, busy, status?.state]);

  if (!api) return null;

  // Nothing to do unless a newer version exists. The checks run on their own, and the menu
  // can still ask for one.
  const pending =
    status?.state === "available" ||
    status?.state === "downloading" ||
    status?.state === "downloaded" ||
    (status?.state === "error" && Boolean(status.availableVersion));
  if (!pending) return null;

  const text = labelFor(status, busy);
  const Icon = status?.state === "downloaded" ? RotateCcw : Download;

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      title={text}
      aria-label={text}
      disabled={busy}
      data-desktop-app-update="true"
      className={`${compact ? "" : "ml-1 "}flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-emerald-600 transition-colors hover:bg-emerald-500/10 hover:text-emerald-700 disabled:opacity-60 dark:text-emerald-400 dark:hover:text-emerald-300`}
    >
      <Icon size={14} className={status?.state === "downloading" ? "animate-pulse" : undefined} />
    </button>
  );
}

// Exported for harness checks (must stay distinct from harness CLI copy).
export const DESKTOP_APP_UPDATE_COPY = COPY;
