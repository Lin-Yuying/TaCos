"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, LogOut, ShieldCheck } from "lucide-react";
import { AssigneeAvatar } from "@/components/issue-table";
import { Menu, MenuItem } from "@/components/menu";
import { listSwitchableUsersAction, switchUserAction, type SwitchUser } from "@/app/admin-actions";
import { logoutAction } from "@/app/auth-actions";

export type UserInfo = {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  siteRole: "admin" | "member";
};

// Raised, pressable disc: light gradient + inner highlight + drop shadow, and a
// sunken state while the menu is open or the button is held down.
const AVATAR_BUTTON =
  "flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(to_bottom,#ffffff,#f0f0f0)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(0,0,0,0.16),0_3px_8px_rgba(0,0,0,0.10)] ring-1 ring-black/[0.06] transition-all duration-150 hover:-translate-y-px hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_4px_rgba(0,0,0,0.18),0_6px_14px_rgba(0,0,0,0.12)] active:translate-y-0 active:bg-[linear-gradient(to_bottom,#f2f2f2,#ffffff)] active:shadow-[inset_0_1px_3px_rgba(0,0,0,0.22)]";

export function UserMenu({ user, workspaceUrl }: { user: UserInfo; workspaceUrl?: string }) {
  const isSiteAdmin = user.siteRole === "admin";
  const [people, setPeople] = useState<SwitchUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void listSwitchableUsersAction().then((result) => {
      if (!active) return;
      if (result.ok) setPeople(result.data.users);
      else setError(result.error);
    });
    return () => {
      active = false;
    };
  }, []);

  async function switchTo(id: string) {
    const result = await switchUserAction(id);
    if (result.ok) window.location.href = result.data.url;
    else setError(result.error);
  }

  return (
    <Menu
      width={224}
      align="right"
      triggerClassName={AVATAR_BUTTON}
      trigger={
        <>
          <AssigneeAvatar displayName={user.displayName} avatar={user.avatar} size={22} />
        </>
      }
    >
      {(close) => (
        <>
          <div className="px-2 py-1.5">
            <div className="text-[13px] font-medium text-text">{user.displayName}</div>
            <div className="text-[11px] text-faint">@{user.username}</div>
          </div>

          {workspaceUrl && (
            <MenuItem
              onSelect={() => {
                close();
                window.location.href = workspaceUrl;
              }}
            >
              <ArrowLeft size={13} /> Back to workspace
            </MenuItem>
          )}

          {people && people.length > 0 && (
            <>
              <div className="my-1 border-t border-border" />
              <div className="px-2 pb-1 pt-1 text-[11px] uppercase tracking-wider text-faint">
                Switch user
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
                      <span className="block truncate text-[11px] text-faint">
                        {person.workspaceName ?? "No workspace"}
                      </span>
                    </span>
                  </MenuItem>
                ))}
              </div>
              {!isSiteAdmin && (
                <div className="px-2 pb-1 pt-0.5 text-[11px] text-faint">
                  Accounts signed in on this device
                </div>
              )}
            </>
          )}

          {isSiteAdmin && (
            <>
              <div className="my-1 border-t border-border" />
              <MenuItem
                onSelect={() => {
                  close();
                  window.location.href = "/admin";
                }}
              >
                <ShieldCheck size={13} /> Admin console
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
                await logoutAction();
                window.location.href = "/login";
              })();
            }}
          >
            <LogOut size={13} /> Sign out
          </MenuItem>
          {error && <div className="px-2 py-1 text-[11px] text-danger">{error}</div>}
        </>
      )}
    </Menu>
  );
}
