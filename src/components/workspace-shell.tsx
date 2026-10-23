"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ChevronRight,
  Inbox,
  List,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Tag,
  Trash2,
  User,
  UserRoundX,
  X,
} from "lucide-react";
import { Menu, MenuItem } from "@/components/menu";
import { leaveWorkspaceAction } from "@/app/auth-actions";
import { ProjectIcon, StatusIcon, WorkspaceMark } from "@/components/icons";
import { AssigneeAvatar } from "@/components/issue-table";
import { IssuePanelHost } from "@/components/issue-panel";
import { UserMenu, type UserInfo } from "@/components/user-menu";
import { useUI, NOTIFICATIONS_READ } from "@/components/ui-context";
import { DEFAULT_PROJECT_COLOR, STATUS_META, STATUS_ORDER } from "@/lib/constants";
import type { Member, Project } from "@/lib/issues";

type WorkspaceInfo = { id: string; name: string; key: string; icon: string | null; role: string };

function NavItem({
  href,
  active,
  icon,
  badge,
  children,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  badge?: number | null;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 rounded-md px-2 py-1 transition-colors ${
        active
          ? "bg-elevated font-medium text-text"
          : "text-muted hover:bg-elevated/60 hover:text-text"
      }`}
    >
      <span className="flex w-4 shrink-0 items-center justify-center text-faint">{icon}</span>
      <span className="truncate">{children}</span>
      {badge ? (
        <span className="ml-auto flex h-[15px] min-w-[15px] shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </Link>
  );
}

function SectionHeader({
  label,
  open,
  onToggle,
  action,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between pr-1 pt-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-w-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-faint transition-colors hover:text-muted"
      >
        <ChevronRight
          size={11}
          className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {label}
      </button>
      {action}
    </div>
  );
}

const COLLAPSED_KEY = "tacos.sidebar.collapsedSections";

function SidebarNav({
  workspace,
  projects,
  favorites,
  members,
  unread,
}: {
  workspace: WorkspaceInfo;
  projects: Project[];
  favorites: Project[];
  members: Member[];
  unread: number | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setProjectComposerOpen } = useUI();
  const view = searchParams.get("view") ?? "all";
  const projectId = searchParams.get("project") ?? "";
  const assignee = searchParams.get("assignee") ?? "";
  const [collapsed, setCollapsed] = useState<string[]>([]);

  // Restored after mount so the server markup and the first client render agree.
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "[]");
      if (Array.isArray(saved)) setCollapsed(saved.filter((key) => typeof key === "string"));
    } catch {
      /* unreadable storage — keep everything expanded */
    }
  }, []);

  function toggleSection(key: string) {
    setCollapsed((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — the section still collapses for this page view */
      }
      return next;
    });
  }

  const open = (key: string) => !collapsed.includes(key);

  const workspaceId = workspace.id;

  const link = (params: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    if (params.view) sp.set("view", params.view);
    if (params.project) sp.set("project", params.project);
    if (params.assignee) sp.set("assignee", params.assignee);
    if (params.label) sp.set("label", params.label);
    const qs = sp.toString();
    return `/${workspaceId}${qs ? `/?${qs}` : ""}`;
  };

  // The four workspace views share one URL and differ only by query params, so a
  // link is active only when every param it sets — including an absent assignee —
  // matches the current query. Otherwise All Issues lights up alongside My Issues.
  const active = (params: Record<string, string | undefined>) =>
    pathname === `/${workspaceId}` &&
    (params.view ?? "all") === view &&
    (params.assignee ?? "") === assignee &&
    (params.project ?? "") === projectId;

  return (
    <nav className="flex-1 overflow-y-auto px-2 py-2 text-[13px]">
      {/* Inbox stays first; the star group only exists once you have starred something. */}
      <div className="pb-1">
        <NavItem
          href={`/${workspaceId}/notifications`}
          active={pathname.endsWith("/notifications")}
          icon={<Inbox size={14} />}
          badge={unread}
        >
          Inbox
        </NavItem>
      </div>
      {favorites.length > 0 && (
        <div className="pb-1">
          <SectionHeader
            label="Favorites"
            open={open("favorites")}
            onToggle={() => toggleSection("favorites")}
          />
          {open("favorites") && (
            <div className="space-y-0.5">
              {favorites.map((project) => (
                <NavItem
                  key={project.id}
                  href={`/${workspaceId}/projects/${project.id}`}
                  active={pathname.startsWith(`/${workspaceId}/projects/${project.id}`)}
                  icon={<ProjectIcon color={project.color} size={14} />}
                >
                  {project.name}
                </NavItem>
              ))}
            </div>
          )}
        </div>
      )}
      <SectionHeader
        label="Workspace"
        open={open("workspace")}
        onToggle={() => toggleSection("workspace")}
      />
      {open("workspace") && (
        <div className="space-y-0.5">
          <NavItem href={link({ view: "all" })} active={active({ view: "all" })} icon={<List size={14} />}>
            All Issues
          </NavItem>
          <NavItem
            href={link({ view: "active" })}
            active={active({ view: "active" })}
            icon={<Activity size={14} />}
          >
            Active
          </NavItem>
          <NavItem
            href={link({ view: "all", assignee: "me" })}
            active={active({ view: "all", assignee: "me" })}
            icon={<User size={14} />}
          >
            My Issues
          </NavItem>
          <NavItem
            href={link({ view: "all", assignee: "none" })}
            active={active({ view: "all", assignee: "none" })}
            icon={<UserRoundX size={14} />}
          >
            Unassigned
          </NavItem>
        </div>
      )}

      <div className="mt-2">
        <SectionHeader
          label="Projects"
          open={open("projects")}
          onToggle={() => toggleSection("projects")}
          action={
            <button
              type="button"
              onClick={() => setProjectComposerOpen(true)}
              title="New project"
              aria-label="New project"
              className="rounded p-1 text-faint transition-colors hover:bg-elevated hover:text-text"
            >
              <Plus size={13} />
            </button>
          }
        />
        {open("projects") && (
          <div className="space-y-0.5">
            {projects.length === 0 && (
              <button
                type="button"
                onClick={() => setProjectComposerOpen(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-muted transition-colors hover:bg-elevated/60 hover:text-text"
              >
                <span className="flex w-4 shrink-0 items-center justify-center text-faint">
                  <Plus size={14} />
                </span>
                No projects yet — create one
              </button>
            )}
            {projects.map((project) => (
              <NavItem
                key={project.id}
                href={`/${workspaceId}/projects/${project.id}`}
                active={pathname.startsWith(`/${workspaceId}/projects/${project.id}`)}
                icon={<ProjectIcon color={project.color} size={14} />}
              >
                {project.name}
              </NavItem>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2">
        <SectionHeader label="Your team" open={open("team")} onToggle={() => toggleSection("team")} />
        {open("team") && (
          <div className="space-y-0.5">
            {members.map((member) => (
              <NavItem
                key={member.id}
                href={link({ view: "all", assignee: member.id })}
                active={searchParams.get("assignee") === member.id}
                icon={
                  <AssigneeAvatar displayName={member.displayName} avatar={member.avatar} size={16} />
                }
              >
                {member.displayName}
              </NavItem>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}

// Polled once by the shell and shared with the sidebar badge and the bell, so reading
// a notification updates both without a second request each.
function useUnreadNotifications(workspaceId: string) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      fetch(`/api/internal/${workspaceId}/notifications`)
        .then((res) => res.json())
        .then((data) => {
          if (active) setCount(data.unread);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 10_000);
    window.addEventListener(NOTIFICATIONS_READ, load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_READ, load);
    };
  }, [workspaceId]);

  return count;
}

// Same raised, pressable affordance as the top-right avatar disc: it lifts on hover and
// sinks while pressed, and stays sunk while its workspace menu is open.
function switcherButton(open: boolean) {
  return (
    "flex min-w-0 items-center gap-1.5 rounded-full border border-border py-1 pl-1 pr-2 text-text ring-1 ring-black/[0.06] transition-all duration-150 hover:-translate-y-px active:translate-y-0 active:shadow-[inset_0_1px_3px_rgba(0,0,0,0.22)] " +
    (open
      ? "translate-y-0 bg-[linear-gradient(to_bottom,#f2f2f2,#ffffff)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.22)]"
      : "bg-[linear-gradient(to_bottom,#ffffff,#f7f7f7)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(0,0,0,0.16),0_3px_8px_rgba(0,0,0,0.10)] hover:bg-[linear-gradient(to_bottom,#ffffff,#f2f2f2)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_4px_rgba(0,0,0,0.18),0_6px_14px_rgba(0,0,0,0.12)]")
  );
}

function WorkspaceSwitcher({
  workspace,
  workspaces,
}: {
  workspace: WorkspaceInfo;
  workspaces: WorkspaceInfo[];
}) {
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  async function leaveWorkspace() {
    if (
      !window.confirm(
        `Leave "${workspace.name}"? A workspace admin has to invite you back with a join code.`
      )
    )
      return;
    setLeaving(true);
    const result = await leaveWorkspaceAction(workspace.id);
    if (!result.ok) {
      setLeaving(false);
      setLeaveError(result.error);
      return;
    }
    const next = workspaces.find((ws) => ws.id !== workspace.id);
    window.location.href = next ? `/${next.id}` : "/onboarding";
  }

  return (
    <Menu
      width={220}
      triggerClassName={switcherButton}
      trigger={(open) => (
        <>
          <WorkspaceMark icon={workspace.icon} className="h-5 w-5" />
          <span className="max-w-[110px] truncate text-[13px] font-semibold">{workspace.name}</span>
          <ChevronRight
            size={11}
            className={`shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`}
          />
        </>
      )}
    >
      {(close) => (
        <>
          {workspaces.map((ws) => (
            <MenuItem
              key={ws.id}
              active={ws.id === workspace.id}
              onSelect={() => {
                close();
                window.location.href = `/${ws.id}`;
              }}
            >
              <span className="flex items-center gap-2">
                <WorkspaceMark icon={ws.icon} className="h-4 w-4" />
                {ws.name}
              </span>
            </MenuItem>
          ))}
          {/* Invited members can walk away; the owner deletes the workspace from Settings. */}
          {workspace.role === "member" && (
            <>
              <div className="my-1 border-t border-border" />
              <MenuItem danger onSelect={() => { if (!leaving) void leaveWorkspace(); }}>
                <span className="flex items-center gap-2">
                  <LogOut size={12} />
                  {leaving ? "Leaving…" : "Leave workspace"}
                </span>
              </MenuItem>
              {leaveError && (
                <div className="px-2 pb-1 text-[11px] leading-snug text-danger">{leaveError}</div>
              )}
            </>
          )}
          <div className="my-1 border-t border-border" />
          <MenuItem
            onSelect={() => {
              close();
              window.location.href = "/onboarding?add=1";
            }}
          >
            <span className="text-accent">+</span> New / join workspace
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

const TABS_KEY = "tacos.tabs.v1";
const SIDEBAR_KEY = "tacos.sidebar.collapsed";
const SIDEBAR_WIDTH_KEY = "tacos.sidebar.width";
const SIDEBAR_DEFAULT = 232;
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 420;
const MAX_TABS = 8;

// The sidebar width is a per-device preference, not workspace data: the same account
// on a laptop and a wide display wants different numbers. Restored after mount so the
// server markup and the first client render agree.
function useSidebarWidth() {
  const [width, setWidth] = useState(SIDEBAR_DEFAULT);

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
      if (saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) setWidth(saved);
    } catch {
      /* storage unavailable — keep the default width */
    }
  }, []);

  // Stable so the drag effect does not re-subscribe on every pixel.
  const resize = useCallback((next: number) => {
    setWidth(next);
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
    } catch {
      /* storage unavailable — the width still applies to this page view */
    }
  }, []);

  return [width, resize] as const;
}

/**
 * Drag handle sitting on the sidebar's right border. The move/up listeners live on
 * `window` because the strip is only 6px wide and slides out from under the cursor as
 * soon as the sidebar grows.
 */
function SidebarResizer({ width, onWidth }: { width: number; onWidth: (next: number) => void }) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef({ x: 0, width: 0 });

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const next = origin.current.width + e.clientX - origin.current.x;
      onWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, next)));
    };
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.userSelect = "";
    };
  }, [dragging, onWidth]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      title="Drag to resize, double-click to reset"
      onPointerDown={(e) => {
        e.preventDefault();
        origin.current = { x: e.clientX, width };
        setDragging(true);
      }}
      onDoubleClick={() => onWidth(SIDEBAR_DEFAULT)}
      className="group absolute -right-[3px] top-0 z-20 h-full w-1.5 cursor-col-resize"
    >
      <div
        className={`h-full w-full transition-colors ${
          dragging ? "bg-accent/40" : "bg-transparent group-hover:bg-accent/20"
        }`}
      />
    </div>
  );
}

function tabMeta(key: string, workspace: WorkspaceInfo, projects: Project[], members: Member[]) {
  const [pathname, query = ""] = key.split("?");
  const params = new URLSearchParams(query);
  const view = params.get("view") ?? "all";
  if (pathname === `/${workspace.id}`) {
    const assignee = params.get("assignee");
    if (view === "all" && assignee === "me") return { label: "My Issues", icon: <User size={13} /> };
    if (view === "all" && assignee === "none")
      return { label: "Unassigned", icon: <UserRoundX size={13} /> };
    if (view === "all" && assignee) {
      const member = members.find((m) => m.id === assignee);
      if (member) return { label: member.displayName, icon: <User size={13} /> };
    }
    const projectId = params.get("project");
    if (view === "all" && projectId) {
      const project = projects.find((p) => p.id === projectId);
      if (project) return { label: project.name, icon: <ProjectIcon color={project.color} size={13} /> };
    }
    const status = STATUS_ORDER.find((s) => s === view);
    if (status)
      return { label: STATUS_META[status].label, icon: <StatusIcon status={status} size={13} /> };
    if (view === "active") return { label: "Active", icon: <Activity size={13} /> };
    return { label: "All Issues", icon: <List size={13} /> };
  }
  const projectPage = pathname.match(new RegExp(`^/${workspace.id}/projects/([^/]+)(?:/issues)?$`));
  if (projectPage) {
    const project = projects.find((p) => p.id === projectPage[1]);
    if (project)
      return { label: project.name, icon: <ProjectIcon color={project.color} size={13} /> };
    return { label: "Project", icon: <ProjectIcon color={DEFAULT_PROJECT_COLOR} size={13} /> };
  }
  if (pathname.endsWith("/settings")) return { label: "Settings", icon: <Settings size={13} /> };  if (pathname.endsWith("/labels")) return { label: "Labels", icon: <Tag size={13} /> };
  if (pathname.endsWith("/trash")) return { label: "Trash", icon: <Trash2 size={13} /> };
  if (pathname.endsWith("/notifications"))
    return { label: "Inbox", icon: <Inbox size={13} /> };
  return { label: "Issues", icon: <List size={13} /> };
}

function TabBar({
  workspace,
  projects,
  members,
  user,
  sidebarOpen,
  sidebarWidth,
  onToggleSidebar,
}: {
  workspace: WorkspaceInfo;
  projects: Project[];
  members: Member[];
  user: UserInfo;
  sidebarOpen: boolean;
  sidebarWidth: number;
  onToggleSidebar: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setPaletteOpen } = useUI();
  const [tabs, setTabs] = useState<string[] | null>(null);
  const justClosed = useRef<string | null>(null);

  // Search text and label filters change too often to deserve their own tab.
  const keyParams = new URLSearchParams();
  for (const name of ["view", "project", "assignee"]) {
    const value = searchParams.get(name);
    if (value) keyParams.set(name, value);
  }
  if (keyParams.get("view") === "all") keyParams.delete("view");
  const qs = keyParams.toString();
  const current = `${pathname}${qs ? `?${qs}` : ""}`;

  // Different URLs can show the same page (a project's Overview and Issues, or
  // `?view=all` vs none); tabs are unique by what they display, not by URL.
  const sameTab = (a: string, b: string) =>
    tabMeta(a, workspace, projects, members).label === tabMeta(b, workspace, projects, members).label;

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(`${TABS_KEY}.${workspace.id}`) ?? "[]");
      const keys: string[] = Array.isArray(saved) ? saved.filter((t) => typeof t === "string") : [];
      setTabs(keys.filter((key, i) => keys.findIndex((other) => sameTab(other, key)) === i));
    } catch {
      setTabs([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  useEffect(() => {
    if (tabs === null) return;
    // Closing the page you are on lands you on its neighbour; neither should be
    // re-added just because the route moved underneath the user.
    if (current === justClosed.current) return;
    if (tabs.includes(current)) return;
    const existing = tabs.findIndex((key) => sameTab(key, current));
    if (existing >= 0) {
      setTabs(tabs.map((key, i) => (i === existing ? current : key)));
      return;
    }
    setTabs([...tabs, current].slice(-MAX_TABS));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, tabs]);

  useEffect(() => {
    if (tabs === null) return;
    try {
      window.localStorage.setItem(`${TABS_KEY}.${workspace.id}`, JSON.stringify(tabs));
    } catch {
      /* storage unavailable — tabs still work for this window */
    }
  }, [tabs, workspace.id]);

  const visible = tabs ?? [];

  function closeTab(key: string) {
    const index = visible.indexOf(key);
    const rest = visible.filter((t) => t !== key);
    setTabs(rest);
    if (key !== current) return;
    justClosed.current = key;
    router.push(rest[Math.max(0, Math.min(index, rest.length - 1))] ?? `/${workspace.id}`);
  }

  return (
    <header className="app-windowbar flex h-12 shrink-0 items-center bg-surface pr-3">
      {/* Same width as the sidebar, so the tabs line up with the content column. */}
      <div
        style={sidebarOpen ? { width: sidebarWidth } : undefined}
        className={`app-windowbar-left flex shrink-0 items-center px-3 ${
          sidebarOpen ? "" : "w-auto"
        }`}
      >
        <button
          type="button"
          onClick={onToggleSidebar}
          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-elevated hover:text-text"
        >
          {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </div>

      <div className="app-tabstrip flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden pl-1.5">
        {visible.map((key) => {
          const { label, icon } = tabMeta(key, workspace, projects, members);
          const isActive = key === current;
          return (
            <div
              key={key}
              className={`app-tab group flex h-8 w-[118px] min-w-0 items-center gap-1.5 rounded-lg border px-2 text-[12.5px] transition-colors ${
                isActive
                  ? "border-border bg-bg font-medium text-text shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
                  : "border-transparent text-muted hover:bg-elevated/70 hover:text-text"
              }`}
            >
              <button
                type="button"
                onClick={() => router.push(key)}
                className="flex min-w-0 flex-1 items-center gap-1.5"
                title={label}
              >
                <span className="flex shrink-0 items-center text-faint">{icon}</span>
                <span className="truncate">{label}</span>
              </button>
              <button
                type="button"
                onClick={() => closeTab(key)}
                aria-label={`Close ${label}`}
                className={`shrink-0 rounded p-0.5 text-faint transition-opacity hover:bg-elevated hover:text-text ${
                  isActive ? "opacity-70" : "opacity-0 group-hover:opacity-70"
                }`}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        title="Open something (⌘K)"
        aria-label="Open something"
        className="ml-1.5 shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-elevated hover:text-text"
      >
        <Plus size={16} />
      </button>

      <div className="ml-1 flex shrink-0 items-center gap-1">
        <UserMenu user={user} />
      </div>
    </header>
  );
}

export function WorkspaceShell({
  workspace,
  user,
  workspaces,
  projects,
  favorites,
  members,
  children,
}: {
  workspace: WorkspaceInfo;
  user: UserInfo;
  workspaces: WorkspaceInfo[];
  projects: Project[];
  favorites: Project[];
  members: Member[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, resizeSidebar] = useSidebarWidth();
  const unread = useUnreadNotifications(workspace.id);

  useEffect(() => {
    try {
      setSidebarOpen(window.localStorage.getItem(SIDEBAR_KEY) !== "1");
    } catch {
      /* storage unavailable — keep the sidebar open */
    }
  }, []);

  function toggleSidebar() {
    setSidebarOpen((open) => {
      try {
        window.localStorage.setItem(SIDEBAR_KEY, open ? "1" : "0");
      } catch {
        /* storage unavailable — the choice still applies to this page view */
      }
      return !open;
    });
  }

  return (
    <div className="flex h-full flex-col">
      <Suspense fallback={<div className="h-12 shrink-0 bg-surface" />}>
        <TabBar
          workspace={workspace}
          projects={projects}
          members={members}
          user={user}
          sidebarOpen={sidebarOpen}
          sidebarWidth={sidebarWidth}
          onToggleSidebar={toggleSidebar}
        />
      </Suspense>

      <div className="flex min-h-0 flex-1 bg-surface">
        {sidebarOpen && (
          <aside
            style={{ width: sidebarWidth }}
            className="relative flex shrink-0 flex-col bg-surface"
          >
            <div className="flex h-12 shrink-0 items-center px-3">
              <WorkspaceSwitcher workspace={workspace} workspaces={workspaces} />
            </div>

            <Suspense fallback={<nav className="flex-1 px-2 py-3" />}>
              <SidebarNav
                workspace={workspace}
                projects={projects}
                favorites={favorites}
                members={members}
                unread={unread}
              />
            </Suspense>

            <div className="space-y-0.5 border-t border-border px-2 py-2">
              <NavItem
                href={`/${workspace.id}/labels`}
                active={pathname.endsWith("/labels")}
                icon={<Tag size={14} />}
              >
                Labels
              </NavItem>
              <NavItem
                href={`/${workspace.id}/trash`}
                active={pathname.endsWith("/trash")}
                icon={<Trash2 size={14} />}
              >
                Trash
              </NavItem>
              <NavItem
                href={`/${workspace.id}/settings`}
                active={pathname.endsWith("/settings")}
                icon={<Settings size={14} />}
              >
                Settings
              </NavItem>
            </div>

            <SidebarResizer width={sidebarWidth} onWidth={resizeSidebar} />
          </aside>
        )}

        {/*
          Linear frames the workspace as a panel: the sidebar and the tab bar share one
          grey surface, and everything you are actually working on sits in a white card
          with its own border and rounded corners, floating in a small gutter.
        */}
        <main className="flex min-w-0 flex-1 flex-col p-2 pt-1">
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-bg shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            {children}
            <IssuePanelHost workspaceId={workspace.id} currentUserId={user.id} />
          </div>
        </main>
      </div>
    </div>
  );
}
