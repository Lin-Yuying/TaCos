"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { Menu, MenuItem } from "@/components/menu";
import { AssigneeAvatar } from "@/components/issue-table";
import { useT } from "@/components/i18n-context";
import { useLiveTick } from "@/components/live-refresh";
import { setWatchAction, setWatchMutedAction, watchStateAction } from "@/app/actions";
import type { WatchScopeType } from "@/lib/constants";
import type { WatchSource, WatchState } from "@/lib/watchers";

const SOURCE_LABEL: Record<WatchSource, string> = {
  manual: "Follows",
  creator: "Creator",
  assignee: "Assignee",
  mention: "Mentioned",
  comment: "Commented",
  migrated: "Following",
};

// U-11: one Follow control for tasks, projects and documents. It owns its state so the
// task panel, project header and document header can drop it in without extra props.
export function WatchControl({
  workspaceId,
  scopeType,
  scopeId,
  compact = false,
}: {
  workspaceId: string;
  scopeType: WatchScopeType;
  scopeId: string;
  compact?: boolean;
}) {
  const t = useT();
  const live = useLiveTick();
  const [state, setState] = useState<WatchState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedAt = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const result = await watchStateAction(workspaceId, scopeType, scopeId);
      if (result.ok) {
        setState(result.data);
        setError(null);
      }
    } catch {
      // A transient read failure leaves the last state in place.
    }
  }, [workspaceId, scopeType, scopeId]);

  useEffect(() => {
    loadedAt.current = Date.now();
    // Load the watcher state when the control mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  // Live refresh: other members' follows change the watcher list, but polling it on
  // every workspace tick is wasteful, so debounce to five seconds.
  useEffect(() => {
    if (Date.now() - loadedAt.current < 5_000) return;
    loadedAt.current = Date.now();
    void refresh();
  }, [live, refresh]);

  async function apply(work: () => Promise<{ ok: boolean; data?: WatchState; error?: string }>) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await work();
      if (result.ok && result.data) setState(result.data);
      else if (!result.ok) setError(result.error ?? "Could not save. Retry.");
    } catch {
      setError("Could not save. Retry.");
    } finally {
      setBusy(false);
    }
  }

  const following = state?.following ?? false;
  const muted = state?.muted ?? false;
  const watchers = state?.watchers ?? [];

  return (
    <span className="relative inline-flex items-center" data-testid={`watch-${scopeType}`}>
      <Menu
        width={248}
        align="right"
        triggerClassName={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-small font-medium transition-colors ${
          following
            ? "border-border-strong bg-elevated text-text"
            : "border-border text-muted hover:border-border-strong hover:text-text"
        }`}
        trigger={
          <span data-testid={`watch-button-${scopeType}`} aria-pressed={following} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            {following ? (muted ? <BellOff size={12} /> : <Bell size={12} />) : <Bell size={12} />}
            {following ? t(muted ? "Muted" : "Following") : t("Follow")}
            {watchers.length > 0 && (
              <span className="text-caption text-faint tabular-nums">{watchers.length}</span>
            )}
          </span>
        }
      >
        {(close) => (
          <div data-testid={`watch-menu-${scopeType}`}>
            <div className="px-2 pb-1 pt-1 text-small text-faint">
              {watchers.length === 1
                ? t("{count} watcher", { count: watchers.length })
                : t("{count} watchers", { count: watchers.length })}
            </div>
            {watchers.length > 0 && (
              <div data-testid="watcher-list" className="max-h-48 overflow-y-auto">
                {watchers.map((watcher) => (
                  <div
                    key={watcher.id}
                    data-testid="watcher-row"
                    className="flex items-center gap-2 rounded-md px-2 py-1"
                  >
                    <AssigneeAvatar displayName={watcher.displayName} avatar={watcher.avatar} size={16} />
                    <span className="min-w-0 flex-1 truncate text-body text-text">{watcher.displayName}</span>
                    <span className="shrink-0 text-caption text-faint">
                      {t(watcher.muted ? "Muted" : SOURCE_LABEL[watcher.source])}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="my-1 h-px bg-border" />
            <MenuItem
              onSelect={() => {
                close();
                void apply(() => setWatchAction(workspaceId, scopeType, scopeId, !following));
              }}
            >
              <span data-testid={`watch-${following ? "unfollow" : "follow"}`}>
                {following ? t("Unfollow") : t("Follow")}
              </span>
            </MenuItem>
            <MenuItem
              disabled={!following}
              onSelect={() => {
                close();
                void apply(() => setWatchMutedAction(workspaceId, scopeType, scopeId, !muted));
              }}
            >
              <span data-testid="watch-mute">
                {muted ? t("Unmute notifications") : t("Mute notifications")}
              </span>
            </MenuItem>
            {!compact && (
              <p className="px-2 pb-1 pt-1 text-caption text-faint">
                {t("Watchers get one Inbox notice per comment. @mentions still reach you when muted.")}
              </p>
            )}
            {error && <p className="px-2 py-1 text-caption text-danger">{t(error)}</p>}
          </div>
        )}
      </Menu>
    </span>
  );
}
