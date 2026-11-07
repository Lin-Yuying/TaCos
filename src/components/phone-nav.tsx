"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Bot, CircleUser, Inbox, Menu as MenuIcon, Plus, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useT } from "@/components/i18n-context";
import { useUI } from "@/components/ui-context";

const TAB = "relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-caption";

function PhoneTab({ href, active, icon, badge, children }: {
  href: string; active: boolean; icon: ReactNode; badge?: number; children: ReactNode;
}) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={`${TAB} ${active ? "font-semibold text-text" : "text-faint"}`}>
      {icon}
      {children}
      {!!badge && <span className="absolute left-1/2 top-1 ml-1.5 rounded-full bg-accent px-1 text-caption leading-4 text-white tabular-nums">{badge}</span>}
    </Link>
  );
}

// Phones get five fixed destinations at the bottom; everything else in the sidebar sits behind "More".
export function PhoneNav({ workspaceId, workspaceName, projects, account, unread, agentAllowed, hidden }: {
  workspaceId: string; workspaceName: string; projects: { id: string; name: string }[]; account: ReactNode; unread: number; agentAllowed: boolean; hidden: string[];
}) {
  const t = useT();
  const pathname = usePathname();
  const params = useSearchParams();
  const { setComposerOpen } = useUI();
  const [drawer, setDrawer] = useState(false);
  const base = `/${workspaceId}`;
  const onTasks = pathname === base;
  const mine = onTasks && params.get("assignee") === "me";
  const entries = [
    { key: "tasks", href: `${base}?view=all`, label: t("All Tasks") },
    { key: "open", href: `${base}?view=open`, label: t("Open Tasks") },
    { key: "review", href: `${base}/review`, label: t("Review") },
    ...projects.map((project) => ({ key: project.id, href: `${base}/projects/${project.id}`, label: project.name })),
    { key: "docs", href: `${base}/docs`, label: t("Documents") },
    { key: "planning", href: `${base}/planning`, label: t("Planning") },
    { key: "activity", href: `${base}/activity`, label: t("Activity") },
    { key: "insights", href: `${base}/insights`, label: t("Insights") },
    { key: "settings", href: `${base}/settings`, label: t("Settings") },
    { key: "help", href: `${base}/help`, label: t("Help") },
    { key: "trash", href: `${base}/trash`, label: t("Trash") },
  ].filter((entry) => !hidden.includes(entry.key));
  return (
    <>
      {onTasks && (
        <button
          type="button"
          aria-label={t("New task")}
          onClick={() => setComposerOpen(true)}
          className="fixed bottom-[72px] right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-lg min-[601px]:hidden"
        >
          <Plus size={20} />
        </button>
      )}
      <nav aria-label={t("Main navigation")} data-phone-nav className="flex shrink-0 border-t border-border bg-bg pb-[env(safe-area-inset-bottom)] min-[601px]:hidden">
        <PhoneTab href={`${base}/notifications`} active={pathname.endsWith("/notifications")} badge={unread} icon={<Inbox size={18} />}>{t("Inbox")}</PhoneTab>
        <PhoneTab href={`${base}?view=all&assignee=me`} active={mine} icon={<CircleUser size={18} />}>{t("My Tasks")}</PhoneTab>
        {agentAllowed && <PhoneTab href={`${base}/agent`} active={pathname.endsWith("/agent")} icon={<Bot size={18} />}>{t("Agent")}</PhoneTab>}
        <PhoneTab href={`${base}/search`} active={pathname.endsWith("/search")} icon={<Search size={18} />}>{t("Search")}</PhoneTab>
        <button type="button" onClick={() => setDrawer(true)} className={`${TAB} text-faint`}>
          <MenuIcon size={18} />
          {t("More")}
        </button>
      </nav>
      <Dialog.Root open={drawer} onOpenChange={setDrawer}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40" />
          <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-[70] flex w-[300px] max-w-[85vw] flex-col bg-bg">
            <Dialog.Title className="border-b border-border px-4 py-3.5 text-body font-semibold">{workspaceName}</Dialog.Title>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {entries.map((entry) => (
                <Link key={entry.key} href={entry.href} onClick={() => setDrawer(false)} className="flex min-h-11 items-center truncate px-4 py-2.5 text-body text-text">
                  {entry.label}
                </Link>
              ))}
            </div>
            <div className="flex items-center border-t border-border px-4 py-2.5">{account}</div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
