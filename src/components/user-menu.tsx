"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, LogOut, ShieldCheck } from "lucide-react";
import { AssigneeAvatar } from "@/components/issue-table";
import { Menu, MenuItem } from "@/components/menu";
import { listSwitchableUsersAction, switchUserAction, type SwitchUser } from "@/app/admin-actions";
import { logoutAction } from "@/app/auth-actions";
import { desktopRunner } from "@/components/runner-bridge";
import { useT } from "@/components/i18n-context";

export type UserInfo = {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  siteRole: "admin" | "member";
};

const AVATAR_BUTTON = "flex size-7 items-center justify-center rounded-full";

export function UserMenu({
  user,
  workspaceUrl,
  adminUrl,
}: {
  user: UserInfo;
  workspaceUrl?: string;
  // Where t("Admin console") goes for this person: the site console for a site admin, the
  // workspace-scoped one for a workspace admin, nothing for everyone else.
  adminUrl?: string | null;
}) {
  const t = useT();
  const isSiteAdmin = user.siteRole === "admin";
  const [people, setPeople] = useState<SwitchUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void listSwitchableUsersAction().then(
      (result) => {
        if (!active) return;
        if (result.ok) setPeople(result.data.users);
        else setError(result.error);
      },
      () => {
        if (active) setError("Could not reach the server. Reload the page and try again.");
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function switchTo(id: string) {
    if (switching) return;
    setSwitching(id);
    setError(null);
    try {
      const result = await switchUserAction(id);
      if (result.ok) {
        window.location.assign(result.data.url);
        return;
      }
      setError(result.error);
    } catch {
      // A build or restart in between can leave this tab holding an action the server
      // no longer knows; without this the click would just do nothing.
      setError("Could not switch accounts. Reload the page and try again.");
    }
    setSwitching(null);
  }

  return (
    <Menu
      width={224}
      align="right"
      triggerClassName={AVATAR_BUTTON}
      trigger={
        <>
          <AssigneeAvatar displayName={user.displayName} avatar={user.avatar} size={28} />
        </>
      }
    >
      {(close) => (
        <>
          <div className="px-2 py-1.5">
            <div className="text-body font-medium text-text">{user.displayName}</div>
            <div className="text-caption text-faint">@{user.username}</div>
          </div>

          {/* Above the list: a tall switch list can push a closing message out of view. */}
          {switching && (
            <div className="px-2 pb-1 text-caption text-faint">{t("Switching account…")}</div>
          )}
          {error && <div className="px-2 pb-1 text-caption text-danger">{t(error)}</div>}

          {workspaceUrl && (
            <MenuItem
              onSelect={() => {
                close();
                window.location.href = workspaceUrl;
              }}
            >
              <ArrowLeft size={13} /> {t("Back to workspace")}
            </MenuItem>
          )}

          {people && people.length > 0 && (
            <>
              <div className="my-1 border-t border-border" />
              <div className="px-2 pb-1 pt-1 text-caption uppercase tracking-wider text-faint">
                {t("Switch user")}
              </div>
              <div className="max-h-52 overflow-y-auto">
                {people.map((person) => (
                  <MenuItem key={person.id} onSelect={() => void switchTo(person.id)}>
                    <AssigneeAvatar
                      displayName={person.displayName}
                      avatar={person.avatar}
                      size={18}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="block truncate">
                        {person.displayName}
                        <span className="text-faint"> @{person.username}</span>
                      </span>
                      <span className="block truncate text-caption text-faint">
                        {person.workspaceName ?? t("No workspace")}
                      </span>
                    </span>
                  </MenuItem>
                ))}
              </div>
              {!isSiteAdmin && (
                <div className="px-2 pb-1 pt-0.5 text-caption text-faint">
                  {t("Accounts signed in on this device")}
                </div>
              )}
            </>
          )}

          {adminUrl && (
            <>
              <div className="my-1 border-t border-border" />
              <MenuItem
                onSelect={() => {
                  close();
                  window.location.href = adminUrl;
                }}
              >
                <ShieldCheck size={13} /> {t("Admin console")}
              </MenuItem>
            </>
          )}

          <div className="my-1 border-t border-border" />
          <MenuItem
            onSelect={() => {
              close();
              // Wait for the session to be deleted before leaving the page; navigating
              // immediately can cancel the request and land back as the old account.
              void (async () => {
                await desktopRunner()?.stop();
                await logoutAction();
                window.location.href = "/login";
              })();
            }}
          >
            <LogOut size={13} /> {t("Sign out")}
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
