"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { rememberTabHash } from "@/lib/ui/tabs";
import { useT } from "@/components/i18n-context";

// Hash values double as deep links (#labels, #cycles, #automations, #page-templates).
const SETTINGS_PAGES = ["profile", "general", "members", "visibility", "projects", "page-templates", "cycles", "automations", "labels", "agent", "usage", "access", "danger"] as const;
export type SettingsPage = (typeof SETTINGS_PAGES)[number];

// Browsers without the Navigation API report a pushState by nothing at all, so one shared
// timer watches the hash for them while a settings page is open.
const polled = new Set<() => void>();
let pollTimer: number | undefined;
let polledHash = "";
function pollHash(listener: () => void) {
  polled.add(listener);
  if (pollTimer === undefined) {
    polledHash = window.location.hash;
    pollTimer = window.setInterval(() => {
      if (window.location.hash === polledHash) return;
      polledHash = window.location.hash;
      polled.forEach((notify) => notify());
    }, 150);
  }
  return () => {
    polled.delete(listener);
    if (polled.size === 0) {
      window.clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };
}

function subscribeHash(listener: () => void) {
  // Next.js moves between hashes with pushState, which fires no hashchange.
  const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
  const stopPolling = navigation ? undefined : pollHash(listener);
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  navigation?.addEventListener("currententrychange", listener);
  return () => {
    stopPolling?.();
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
    navigation?.removeEventListener("currententrychange", listener);
  };
}

export function useSettingsPage(): SettingsPage {
  // A soft navigation back to a page first loaded with a hash can arrive with it doubled.
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1).split("#")[0], () => "");
  return (SETTINGS_PAGES as readonly string[]).includes(hash) ? (hash as SettingsPage) : "profile";
}

export function SettingsPanel({ id, title, children }: { id: SettingsPage; title: string; children: ReactNode }) {
  const active = useSettingsPage() === id;
  return (
    <div hidden={!active} data-settings-page={id} className="space-y-6">
      <h1 className="text-title font-semibold">{title}</h1>
      {children}
    </div>
  );
}

type NavItem = { key: string; label: string; href: string; page?: SettingsPage; testId?: string };

export function SettingsShell({
  workspaceId,
  canTransfer,
  isOwner,
  isInstanceAdmin,
  children,
}: {
  workspaceId: string;
  canTransfer: boolean;
  isOwner: boolean;
  isInstanceAdmin: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  const hashPage = useSettingsPage();
  const base = `/${workspaceId}/settings`;
  const onMain = pathname === base;
  useEffect(() => {
    if (!onMain) return;
    rememberTabHash(base, `#${hashPage}`);
    if (window.location.hash.lastIndexOf("#") > 0) {
      history.replaceState(history.state, "", `${window.location.pathname}${window.location.search}#${window.location.hash.slice(1).split("#")[0]}`);
    }
  });
  const page = (id: SettingsPage, label: string): NavItem => ({ key: id, label, href: `${base}#${id}`, page: id });
  const route = (segment: string, label: string, testId?: string): NavItem => ({ key: segment, label, href: `${base}/${segment}`, testId });
  const groups: { title: string; items: NavItem[] }[] = [
    { title: t("Personal"), items: [page("profile", t("Profile and display"))] },
    {
      title: t("Workspace"),
      items: [
        page("general", t("Basics and icon")),
        page("members", t("Members")),
        page("visibility", t("Task visibility")),
        page("projects", t("Projects")),
        page("page-templates", t("Page templates")),
        page("cycles", t("Cycle settings")),
        page("automations", t("Automations")),
        page("labels", t("Labels")),
      ],
    },
    {
      title: t("Agent"),
      items: [
        page("agent", t("Harness and model API")),
        page("usage", t("Agent usage")),
        page("access", t("Agent access: REST and MCP")),
      ],
    },
    {
      title: t("Data"),
      items: [
        route("storage", t("Storage and recovery")),
        ...(canTransfer ? [route("export", t("Export"), "settings-export-link"), route("import", t("Import"), "settings-import-link")] : []),
        ...(isInstanceAdmin ? [route("system", t("System"))] : []),
      ],
    },
    ...(isOwner ? [{ title: t("Other"), items: [page("danger", t("Danger zone"))] }] : []),
  ];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 max-[760px]:flex-col" data-testid="settings-shell">
      <nav
        aria-label={t("Settings sections")}
        className="flex w-[216px] shrink-0 flex-col gap-px overflow-auto border-r border-border px-2 py-3 max-[760px]:w-full max-[760px]:flex-row max-[760px]:border-b max-[760px]:border-r-0"
      >
        {groups.map((group) => (
          <div key={group.title} className="flex flex-col gap-px max-[760px]:flex-row">
            <h2 className="mx-2 mb-1 mt-3 text-small font-medium text-faint max-[760px]:hidden">{group.title}</h2>
            {group.items.map((item) => {
              const active = item.page ? onMain && hashPage === item.page : pathname === item.href;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  data-testid={item.testId}
                  aria-current={active ? "page" : undefined}
                  onClick={(event) => {
                    if (!item.page || !onMain || event.metaKey || event.ctrlKey) return;
                    event.preventDefault();
                    window.location.hash = item.page;
                  }}
                  className={`flex h-7 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-small transition-colors hover:bg-elevated ${active ? "bg-elevated font-medium text-text" : "text-muted"}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
