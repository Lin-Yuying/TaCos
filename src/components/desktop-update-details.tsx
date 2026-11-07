"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/i18n-context";
import type { AppUpdateApi, AppUpdateStatus } from "./desktop-app-update-button";

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

  const unsigned = status?.unsigned;
  return (
    <div className="rounded-lg border border-border p-3" data-testid="desktop-update">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-body font-medium">{t("Desktop app")}</p>
        <span className="rounded-full border border-border px-1.5 py-0.5 text-caption text-muted">
          {unsigned == null ? t("Not packaged") : unsigned ? t("Unsigned build") : t("Signed build")}
        </span>
        <span className="text-small text-muted">{t("Stable channel")}</span>
      </div>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-small sm:grid-cols-[minmax(120px,auto)_1fr]">
        <dt className="text-muted">{t("Current version")}</dt>
        <dd className="font-mono tabular-nums">{status?.currentVersion || "—"}</dd>
        <dt className="text-muted">{t("Available version")}</dt>
        <dd className="font-mono tabular-nums">{status?.availableVersion || t("None")}</dd>
        <dt className="text-muted">{t("State")}</dt>
        <dd>{t(STATE_LABEL[status?.state ?? "idle"] ?? status?.state ?? "Idle")}</dd>
        {status?.releaseDate && (
          <>
            <dt className="text-muted">{t("Released")}</dt>
            <dd className="tabular-nums">{status.releaseDate.slice(0, 10)}</dd>
          </>
        )}
      </dl>
      {status?.releaseNotes && (
        <div className="mt-2">
          <p className="text-small font-medium">{t("Release notes")}</p>
          <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-small text-muted">
            {status.releaseNotes}
          </p>
        </div>
      )}
      {status?.state === "error" && (
        <p role="alert" className="mt-2 break-words text-small text-danger">
          {status.error}
        </p>
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
