"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, RotateCcw } from "lucide-react";

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
  upToDate: "应用已是最新",
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
  if (status.state === "not-available") return COPY.upToDate;
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
      if (status?.state === "downloaded") {
        await api.install();
        return;
      }
      if (status?.state === "available") {
        await api.download();
        return;
      }
      await api.check();
    } finally {
      setBusy(false);
    }
  }, [api, busy, status?.state]);

  if (!api) return null;

  // Packaged builds report enabled=true. Dev desktop still exposes the API but stays idle.
  const text = labelFor(status, busy);
  const ready = status?.state === "downloaded";
  const Icon =
    ready ? RotateCcw : status?.state === "downloading" || busy ? RefreshCw : Download;

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => void onClick()}
        title={text}
        aria-label={text}
        disabled={busy && !ready}
        data-desktop-app-update="true"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated/60 hover:text-text disabled:opacity-60"
      >
        <Icon size={14} className={busy && !ready ? "animate-spin" : undefined} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      title={text}
      aria-label={text}
      disabled={busy && !ready}
      data-desktop-app-update="true"
      className={
        "ml-1 flex max-w-[148px] shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-caption font-medium transition-colors disabled:opacity-60 " +
        (ready
          ? "border-accent/40 bg-accent/10 text-accent hover:bg-accent/15"
          : "border-border bg-elevated/40 text-muted hover:bg-elevated hover:text-text")
      }
    >
      <Icon size={12} className={busy && !ready ? "animate-spin" : undefined} />
      <span className="truncate">{text}</span>
    </button>
  );
}

// Exported for harness checks (must stay distinct from harness CLI copy).
export const DESKTOP_APP_UPDATE_COPY = COPY;
