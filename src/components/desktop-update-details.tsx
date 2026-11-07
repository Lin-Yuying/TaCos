"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/i18n-context";
import { useUI } from "@/components/ui-context";
import { DESKTOP_APP_UPDATE_COPY, agentIsWorking, type AppUpdateApi, type AppUpdateStatus } from "./desktop-app-update-button";

function desktopUpdateApi(): AppUpdateApi | null {
  return (
    window as unknown as { tacosDesktop?: { appUpdate?: AppUpdateApi } }
  ).tacosDesktop?.appUpdate ?? null;
}

const STATE_LABEL: Record<string, string> = {
  idle: "Idle",
  checking: "Checking for updates",
  available: "Update available",
  downloading: "Downloading",
  downloaded: "Ready to install",
  "not-available": "Up to date",
  error: "Update failed",
};

/**
 * U-12: the desktop app's update channel, release notes, signature state and failure
 * message, shown inside Settings → System. The top-bar pill still installs the update.
 */
export function DesktopUpdateDetails() {
  const t = useT();
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [present, setPresent] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const { confirm } = useUI();

  useEffect(() => {
    const api = desktopUpdateApi();
    if (!api) return;
    let cancelled = false;
    const off = api.onStatus((next) => {
      if (cancelled) return;
      setPresent(true);
      setStatus(next);
    });
    void api
      .getStatus()
      .then((next) => {
        if (cancelled) return;
        setPresent(true);
        setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setPresent(true);
      });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  if (!present) {
    return (
      <div className="rounded-lg border border-border p-3 text-small text-muted" data-testid="desktop-update">
        <p className="font-medium text-body">{t("Desktop app")}</p>
        <p className="mt-1">
          {t("Open TaCos from the desktop app to read its update channel, release notes and signature state.")}
        </p>
        <p className="mt-1">
          {t("Unsigned builds open the GitHub download page; code signing stays with the owner.")}
        </p>
      </div>
    );
  }

  // Restarting ends a running Agent turn, so this asks first, the way the pill does.
  async function installAndRestart() {
    const api = desktopUpdateApi();
    if (!api) return;
    if (!api.restart) {
      await api.install();
      return;
    }
    if (
      (await agentIsWorking()) &&
      !(await confirm(DESKTOP_APP_UPDATE_COPY.busyTitle, {
        body: DESKTOP_APP_UPDATE_COPY.busyBody,
        action: DESKTOP_APP_UPDATE_COPY.busyConfirm,
      }))
    )
      return;
    setPreparing(true);
    const result = await api.restart().catch(() => null);
    if (!result?.ok || result.degraded) setPreparing(false);
  }

  const state = status?.state ?? "idle";
  const version = status?.availableVersion ?? undefined;
  const row: { label: string; detail?: string; action?: { label: string; primary: boolean; run: () => unknown } } = preparing
    ? { label: t("Preparing to restart") }
    : state === "available"
      ? { label: t("New version available"), detail: version, action: { label: t("Download"), primary: true, run: () => desktopUpdateApi()?.install() } }
      : state === "downloading"
        ? status?.stage === "unpacking"
          ? { label: t("Unpacking") }
          : status?.stage === "verifying"
            ? { label: t("Checking the signature") }
            : { label: t("Downloading"), detail: typeof status?.progress === "number" ? `${Math.round(status.progress)}%` : undefined }
        : state === "downloaded"
          ? { label: t("Ready to install"), detail: version, action: { label: t("Install and restart"), primary: true, run: installAndRestart } }
          : state === "error"
            ? { label: t("Update failed"), detail: status?.error ?? undefined, action: { label: t("Retry"), primary: false, run: () => desktopUpdateApi()?.check() } }
            : { label: t(STATE_LABEL[state] ?? state) };

  const unsigned = status?.unsigned;
  return (
    <div className="rounded-lg border border-border p-3" data-testid="desktop-update">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-body font-medium">{t("Desktop app")}</p>
        <span className="inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap border border-border text-caption text-muted">
          {unsigned == null ? t("Not packaged") : unsigned ? t("Unsigned build") : t("Signed build")}
        </span>
        <span className="text-small text-muted">{t("Stable channel")}</span>
      </div>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-small sm:grid-cols-[minmax(120px,auto)_1fr]">
        <dt className="text-muted">{t("Current version")}</dt>
        <dd className="font-mono tabular-nums">{status?.currentVersion || "—"}</dd>
        <dt className="text-muted">{t("Available version")}</dt>
        <dd className="font-mono tabular-nums">{status?.availableVersion || t("None")}</dd>
        {status?.releaseDate && (
          <>
            <dt className="text-muted">{t("Released")}</dt>
            <dd className="tabular-nums">{status.releaseDate.slice(0, 10)}</dd>
          </>
        )}
      </dl>
      <div className="mt-2 flex items-center gap-3 rounded-md border border-border px-3 py-2" data-testid="desktop-update-state">
        <div className="min-w-0 flex-1">
          <div className="text-small font-medium text-text">{row.label}</div>
          {row.detail && (
            <div role={state === "error" ? "alert" : undefined} className={`break-words text-small tabular-nums ${state === "error" ? "text-danger" : "text-faint"}`}>
              {row.detail}
            </div>
          )}
        </div>
        {row.action && (
          <button
            type="button"
            onClick={() => void row.action?.run()}
            className={row.action.primary
              ? "shrink-0 rounded-md bg-accent px-3 py-1.5 text-small font-medium text-white transition-colors hover:bg-accent-hover"
              : "shrink-0 rounded-md border border-border px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text"}
          >
            {row.action.label}
          </button>
        )}
      </div>
      {status?.releaseNotes && (
        <div className="mt-2">
          <p className="text-small font-medium">{t("Release notes")}</p>
          <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-small text-muted">
            {status.releaseNotes}
          </p>
        </div>
      )}
      <p className="mt-2 text-small text-muted">
        {t(
          "If an update fails, retry from the update pill in the tab bar. If it keeps failing, install the previous release from GitHub."
        )}
      </p>
      {unsigned === true && (
        <p className="mt-1 text-small text-update-text">
          {t("This build is not signed. Updates open the GitHub download page instead of installing in place.")}
        </p>
      )}
    </div>
  );
}
