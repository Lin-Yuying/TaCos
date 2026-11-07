"use client";
import { usePrimaryModifier } from "@/lib/ui/platform";

import * as ContextMenu from "@radix-ui/react-context-menu";
import { useStoredJson } from "@/lib/use-stored-json";
import { EntityRow,usePinned } from "@/components/ui/entity-row";

import { PersonalOrder } from "@/components/personal-order";
import { RecentDocuments } from "@/components/recent-documents";
import Link from "next/link";
import { tabIdentity } from "@/lib/ui/tabs";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  CalendarRange,
  ChartNoAxesColumn,
  Hand,
  Bot,
  Boxes,
  ChevronRight,
  CircleHelp,
  FileText,
  Inbox,
  LayoutList,
  List,
  LogOut,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  Tag,
  Trash2,
  ShieldCheck,
  User,
  UserRoundX,
  Users,
  X,
} from "lucide-react";
import { Menu, MenuItem } from "@/components/menu";
import { InviteDialog } from "@/components/invite-dialog";
import { LiveRefresh } from "@/components/live-refresh";
import { DesktopOpenFiles } from "@/components/desktop-open-files";
import { DesktopAppUpdateButton } from "@/components/desktop-app-update-button";
import { leaveWorkspaceAction } from "@/app/auth-actions";
import { DOCS_DELETED_EVENT } from "@/components/tab-events";
import type { PageRef, PageSummary } from "@/lib/pages";
import { DocTree } from "@/components/doc-tree";
import { WorkspaceViews } from "@/components/workspace-views";
import { ProjectIcon, StatusIcon, WorkspaceMark } from "@/components/icons";
import { AssigneeAvatar } from "@/components/issue-table";
import { IssuePanelHost } from "@/components/issue-panel";
import { DetailLayout } from "@/components/ui/detail-layout";
import { DocPanelHost } from "@/components/doc-panel";
import { UserMenu, type UserInfo } from "@/components/user-menu";
import { useUI, NOTIFICATIONS_READ } from "@/components/ui-context";
import { DEFAULT_PROJECT_COLOR, STATUS_META, STATUS_ORDER } from "@/lib/constants";
import type { Member, Project } from "@/lib/issues";
import { useT } from "@/components/i18n-context";
import type { Translate } from "@/lib/i18n";

type WorkspaceInfo = {
  id: string;
  name: string;
  key: string;
  icon: string | null;
  role: string;
  createdBy: string | null;
};

// The roster keeps a fixed order — you, the workspace owner, then everyone else by join
// order — so opening different people never shuffles the rows under the pointer.
function orderTeam(members: Member[], viewerId: string, ownerId: string | null): Member[] {
  const rank = (member: Member) =>
    member.id === viewerId ? 0 : member.id === ownerId ? 1 : 2;
  return [...members].sort((a, b) => rank(a) - rank(b));
}

function NavItem({
  href,
  active,
  icon,
  badge,
  tag,
  disabled,
  title,
  testId,
  children,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  badge?: number | null;
  tag?: ReactNode;
  disabled?: boolean;
  title?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      title={title}
      data-testid={testId}
      aria-disabled={disabled || undefined}
      className={`flex items-center gap-2 rounded-md px-2 py-1 transition-colors ${
        disabled
          ? "cursor-not-allowed text-faint opacity-60"
          : active
            ? "bg-elevated font-medium text-text"
            : "text-muted hover:bg-elevated/60 hover:text-text"
      }`}
    >
      <span className="flex w-4 shrink-0 items-center justify-center text-faint">{icon}</span>
      <span className="truncate">{children}</span>
      {tag ? (
        <span className="ml-auto shrink-0 rounded-full border border-border px-1.5 py-px text-caption text-faint">
          {tag}
        </span>
      ) : null}
      {badge ? (
        <span className="ml-auto flex h-[15px] min-w-[15px] shrink-0 items-center justify-center rounded-full bg-accent px-1 text-caption font-semibold text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </Link>
  );
}

function SectionHeader({
  label,
  icon,
  open,
  onToggle,
  action,
}: {
  label: string;
  // Every group carries its own glyph so the heading still reads once the sidebar is
  // folded to a rail — the same icon comes back there as the group's only label.
  icon: ReactNode;
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
        className="flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-small font-medium uppercase tracking-wider text-faint transition-colors hover:text-muted"
      >
        <ChevronRight
          size={11}
          className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="flex shrink-0 items-center justify-center">{icon}</span>
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
  favoritePages,
  pages,
  members,
  viewerId,
  unread,
  openTasks,
  reviewTasks,
  hidden,
  width,
  agentAllowed,
  onToggleSection,
  onInvite,
}: {
  workspace: WorkspaceInfo;
  projects: Project[];
  favorites: Project[];
  favoritePages: PageRef[];
  pages: PageSummary[];
  members: Member[];
  viewerId: string;
  unread: number | null;
  hidden: string[];
  // The column's current width: the Customize menu is as wide as the sidebar itself,
  // so it has to follow a drag rather than guess a number.
  width: number;
  openTasks: number;
  reviewTasks: number;
  agentAllowed: boolean;
  onToggleSection: (key: string) => void;
  onInvite: () => void;
}) {
  const shownProjects=usePinned(projects,"project");
  const t = useT();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setProjectComposerOpen, pins } = useUI();
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

  const team = orderTeam(members, viewerId, workspace.createdBy);

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
  // Active, Unassigned and Agent tasks became list-header quick filters, so the All
  // Tasks row stays highlighted while one of them is on.
  const allTasksActive =
    active({ view: "all" }) ||
    active({ view: "active" }) ||
    active({ view: "agent" }) ||
    active({ view: "all", assignee: "none" });

  return (
    <nav data-sidebar-nav className="flex-1 overflow-y-auto px-2 py-2 text-body">
      <div className="pb-1">
        <NavItem
          href={`/${workspaceId}/notifications`}
          active={pathname.endsWith("/notifications")}
          icon={<Inbox size={14} />}
          badge={unread}
        >
          {t("Inbox")}
        </NavItem>
      </div>
      <div className="pb-1">
        <NavItem
          href={`/${workspaceId}/activity`}
          active={pathname.endsWith("/activity")}
          icon={<Activity size={14} />}
        >
          {t("Activity")}
        </NavItem>
      </div>
      <div className="pb-1">
        <NavItem
          href={`/${workspaceId}/planning`}
          active={pathname.startsWith(`/${workspaceId}/planning`)}
          icon={<CalendarRange size={14} />}
          testId="nav-planning"
        >
          {t("Planning")}
        </NavItem>
      </div>
      <div className="pb-1">
        <NavItem
          href={`/${workspaceId}/insights`}
          active={pathname.startsWith(`/${workspaceId}/insights`)}
          icon={<ChartNoAxesColumn size={14} />}
          testId="nav-insights"
        >
          {t("Insights")}
        </NavItem>
      </div>
      <div className="pb-1">
        <NavItem
          href={`/${workspaceId}/search`}
          active={pathname.endsWith("/search")}
          icon={<Search size={14} />}
          tag={
            <kbd className="rounded border border-border bg-bg px-1 font-mono text-caption">
              /
            </kbd>
          }
        >
          {t("Search")}
        </NavItem>
      </div>
      <div className="pb-1">
        <NavItem
          href={`/${workspaceId}/agent`}
          active={pathname.endsWith("/agent")}
          icon={<Bot size={14} />}
          disabled={!agentAllowed}
          title={
            agentAllowed ? undefined : "Agent is disabled. Enable a ready harness in Settings."
          }
        >
          {t("Agent")}
        </NavItem>
      </div>
      <div className="pb-1">
        <SectionHeader
          label={t("Tasks")}
          icon={<LayoutList size={11} />}
          open={open("tasks")}
          onToggle={() => toggleSection("tasks")}
        />
        {open("tasks") && (
          <div className="space-y-0.5">
            <NavItem
              href={link({ view: "all", assignee: "me" })}
              active={active({ view: "all", assignee: "me" })}
              icon={<User size={14} />}
            >
              {t("My Tasks")}
            </NavItem>
            <NavItem
              href={link({ view: "open" })}
              active={active({ view: "open" })}
              icon={<Hand size={14} />}
              badge={openTasks || null}
            >
              {t("Open Tasks")}
            </NavItem>
            <NavItem href={link({ view: "all" })} active={allTasksActive} icon={<List size={14} />}>
              {t("All Tasks")}
            </NavItem>
            <WorkspaceViews workspaceId={workspaceId} />
            <NavItem
              href={`/${workspaceId}/review`}
              active={pathname.endsWith("/review")}
              icon={<ShieldCheck size={14} />}
              badge={reviewTasks || null}
            >
              {t("Review")}
            </NavItem>
          </div>
        )}
      </div>
      {(favorites.length > 0 || favoritePages.length > 0) && (
        <div className="pb-1">
          <SectionHeader
            label={t("Favorites")}
            icon={<Star size={11} />}
            open={open("favorites")}
            onToggle={() => toggleSection("favorites")}
          />
          {open("favorites") && (
            <div className="space-y-0.5"><PersonalOrder workspaceId={workspaceId} group="favorite" items={favorites.map(p=>({kind:"project" as const,id:p.id,title:p.name}))}/>
              {favorites.map((project) => (
                <EntityRow key={project.id} kind="project" id={project.id} title={project.name}>
<NavItem
                  key={project.id}
                  href={`/${workspaceId}/projects/${project.id}`}
                  active={pathname.startsWith(`/${workspaceId}/projects/${project.id}`)}
                  icon={<ProjectIcon color={project.color} icon={project.icon} size={14} />}
                >
                  {project.name}
                </NavItem>
</EntityRow>
              ))}
              {favoritePages.length>1&&<PersonalOrder workspaceId={workspaceId} group="favorite" items={favoritePages.map(p=>({kind:"document" as const,id:p.id,title:p.title}))}/>}
              {favoritePages.map((page) => (
                <EntityRow key={page.id} kind="document" id={page.id} title={page.title}>
<NavItem
                  key={page.id}
                  href={`/${workspaceId}/docs/${page.id}`}
                  active={pathname === `/${workspaceId}/docs/${page.id}`}
                  icon={page.icon ?? <FileText size={13} />}
                >
                  {page.title}
                </NavItem>
</EntityRow>
              ))}
            </div>
          )}
        </div>
      )}
      <RecentDocuments workspaceId={workspaceId} pages={pages}/>{pins.length>0&&<section><div className="px-2 py-2 text-small text-faint">{t("Pinned")}<PersonalOrder workspaceId={workspaceId} group="pin" items={pins}/></div>{pins.map(pin=><EntityRow key={`${pin.kind}:${pin.id}`} kind={pin.kind} id={pin.id} title={pin.title}><NavItem href={pin.href} active={false} icon={<Star size={13}/>}>{pin.title}</NavItem></EntityRow>)}</section>}
      <div className="mt-2">
        <SectionHeader
          label={t("Projects")}
          icon={<Boxes size={11} />}
          open={open("projects")}
          onToggle={() => toggleSection("projects")}
          action={
            <button
              type="button"
              onClick={() => setProjectComposerOpen(true)}
              title={t("New project")}
              aria-label={t("New project")}
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
                {t("No projects yet — create one")}
              </button>
            )}
            {shownProjects.map((project) => (
              <EntityRow key={project.id} kind="project" id={project.id} title={project.name}>
<NavItem
                key={project.id}
                href={`/${workspaceId}/projects/${project.id}`}
                active={pathname.startsWith(`/${workspaceId}/projects/${project.id}`)}
                icon={<ProjectIcon color={project.color} icon={project.icon} size={14} />}
              >
                {project.name}
              </NavItem>
</EntityRow>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2">
        <SectionHeader
          label={t("Documents")}
          icon={<FileText size={11} />}
          open={open("documents")}
          onToggle={() => toggleSection("documents")}
        />
        {open("documents") && <DocTree workspaceId={workspaceId} pages={pages} />}
      </div>

      <div className="mt-2">
        <SectionHeader
          label={t("Your team")}
          icon={<Users size={11} />}
          open={open("team")}
          onToggle={() => toggleSection("team")}
          action={
            <button
              type="button"
              onClick={onInvite}
              title={t("Invite teammates")}
              aria-label={t("Invite teammates")}
              className="rounded p-1 text-faint transition-colors hover:bg-elevated hover:text-text"
            >
              <Plus size={13} />
            </button>
          }
        />
        {open("team") && (
          <div className="space-y-0.5">
            {team.map((member) => (
              <NavItem
                key={member.id}
                href={`/${workspaceId}/people/${member.id}`}
                active={
                  pathname === `/${workspaceId}/people/${member.id}` ||
                  searchParams.get("assignee") === member.id
                }
                icon={
                  <AssigneeAvatar displayName={member.displayName} avatar={member.avatar} size={16} />
                }
                tag={member.id === workspace.createdBy ? t("Owner") : undefined}
              >
                {member.displayName}
              </NavItem>
            ))}
          </div>
        )}
      </div>

      {/* Same idea as Notion's t("Customize sidebar"): sections that are useful to some
          people but clutter for everyone else can be taken out and put back here. */}
      <div className="px-1 pt-3">
        <Menu
          width={width}
          // Undo the nav's px-2 and this row's px-1 so the panel's edges are the
          // sidebar's edges, not the trigger's.
          offset={-12}
          triggerClassName="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-small text-faint transition-colors hover:bg-elevated/60 hover:text-text"
          trigger={
            <>
              <span className="flex w-4 shrink-0 items-center justify-center">
                <SlidersHorizontal size={12} />
              </span>
              <span className="truncate">{t("Customize sidebar")}</span>
            </>
          }
        >
          {() => {
            const shown = SIDEBAR_SECTIONS.filter((section) => !hidden.includes(section.key));
            const available = SIDEBAR_SECTIONS.filter((section) => hidden.includes(section.key));
            return (
              <>
                <div className="px-2 pb-1 pt-1 text-small uppercase tracking-wide text-faint">
                  {t("In sidebar")}
                </div>
                {shown.map((section) => (
                  <MenuItem key={section.key} onSelect={() => onToggleSection(section.key)}>
                    <section.icon size={13} className="text-faint" />
                    <span className="flex-1 truncate">{t(section.label)}</span>
                    <Minus size={12} className="text-faint" />
                  </MenuItem>
                ))}
                {available.length > 0 && (
                  <>
                    <div className="my-1 border-t border-border" />
                    <div className="px-2 pb-1 pt-1 text-small uppercase tracking-wide text-faint">
                      {t("Available")}
                    </div>
                    {available.map((section) => (
                      <MenuItem key={section.key} onSelect={() => onToggleSection(section.key)}>
                        <section.icon size={13} className="text-faint" />
                        <span className="flex-1 truncate">{t(section.label)}</span>
                        <Plus size={12} className="text-faint" />
                      </MenuItem>
                    ))}
                  </>
                )}
              </>
            );
          }}
        </Menu>
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
    let request: AbortController | null = null;
    const load = async () => {
      if (!active || request || document.visibilityState !== "visible") return;
      request = new AbortController();
      const timeout = window.setTimeout(() => request?.abort(),8000);
      try {
        const res=await fetch(`/api/internal/${workspaceId}/notifications?countOnly=1`,{signal:request.signal,cache:"no-store"});
        if (!res.ok) return;
        const data=await res.json();
        if (active && typeof data.unread === "number") setCount(data.unread);
      } catch { /* retry on the next visible tick */ }
      finally {window.clearTimeout(timeout);request=null;}
    };
    void load();
    const timer = setInterval(() => void load(), 10_000);
    window.addEventListener(NOTIFICATIONS_READ, load);
    document.addEventListener("visibilitychange",load);
    return () => {
      active=false;request?.abort();clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_READ,load);
      document.removeEventListener("visibilitychange",load);
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
  compact,
}: {
  workspace: WorkspaceInfo;
  workspaces: WorkspaceInfo[];
  compact?: boolean;
}) {
  const t = useT();
  const {confirm}=useUI();
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  async function leaveWorkspace() {
    if (
      !await confirm(
        t('Leave "{name}"? A workspace admin has to invite you back with a join code.', {
          name: workspace.name,
        })
      )
    )
      return;
    setLeaving(true);
    try {
    const result = await leaveWorkspaceAction(workspace.id);
    if (!result.ok) {
      setLeaving(false);
      setLeaveError(result.error);
      return;
    }
    const next = workspaces.find((ws) => ws.id !== workspace.id);
    window.location.href = next ? `/${next.id}` : "/onboarding";
    }catch{setLeaving(false);setLeaveError("Could not save. Retry.");}
  }

  return (
    <Menu
      width={220}
      triggerClassName={(open) =>
        compact ? `${switcherButton(open)} justify-center px-1.5` : switcherButton(open)
      }
      trigger={(open) =>
        compact ? (
          <WorkspaceMark icon={workspace.icon} className="h-5 w-5" />
        ) : (
          <>
            <WorkspaceMark icon={workspace.icon} className="h-5 w-5" />
            <span className="max-w-[110px] truncate text-body font-semibold">{workspace.name}</span>
            <ChevronRight
              size={11}
              className={`shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`}
            />
          </>
        )
      }
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
                  {leaving ? t("Leaving…") : t("Leave workspace")}
                </span>
              </MenuItem>
              {leaveError && (
                <div className="px-2 pb-1 text-caption leading-snug text-danger">{t(leaveError)}</div>
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
            <span className="text-accent">+</span> {t("New / join workspace")}
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function RailLink({
  href,
  active,
  label,
  icon,
  dot,
  labeled,
  disabled,
  testId,
}: {
  href: string;
  active: boolean;
  label: string;
  icon: ReactNode;
  dot?: boolean;
  labeled?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  const activeLook = disabled
    ? "cursor-not-allowed text-faint opacity-60"
    : active
      ? "bg-elevated text-text"
      : "text-muted hover:bg-elevated/60 hover:text-text";
  const title = disabled
    ? "Agent is disabled. Enable a ready harness in Settings."
    : label;
  // Past the label threshold the rail stops being a rail and reads as a compact
  // sidebar, so the name sits next to the icon instead of hiding in a tooltip.
  if (labeled) {
    return (
      <Link
        href={href}
        title={title}
        aria-label={label}
        aria-disabled={disabled || undefined}
        data-testid={testId}
        className={`relative flex h-8 items-center gap-2 rounded-md px-2 text-body font-medium transition-colors ${activeLook}`}
      >
        <span className="flex w-4 shrink-0 items-center justify-center">{icon}</span>
        <span className="truncate">{label}</span>
        {dot && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
      </Link>
    );
  }
  return (
    <Link
      href={href}
      title={title}
      aria-label={label}
      aria-disabled={disabled || undefined}
      data-testid={testId}
      className={`relative flex h-8 w-8 items-center justify-center rounded-md transition-colors ${activeLook}`}
    >
      {icon}
      {dot && (
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
      )}
    </Link>
  );
}

// A group heading in the folded sidebar. "FAVORITES" cannot fit in 48px, so the group
// keeps its glyph and — when the rail is wide enough to carry labels — the heading. The
// group's rows cannot fit either, and widening the column to reveal them would make it
// jump out from under the pointer, so the glyph raises a flyout instead. The panel is
// portalled: the nav scrolls, which would clip it, and it has to sit beside the column,
// not inside it.
const RAIL_FLYOUT_WIDTH = 236;

function RailFlyout({
  label,
  icon,
  labeled,
  children,
}: {
  label: string;
  icon: ReactNode;
  labeled: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Null until measured, which keeps the panel invisible on its first paint.
  const [rect, setRect] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setRect(null);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const gap = 8;
    const margin = 8;
    const anchor = trigger.getBoundingClientRect();
    const maxHeight = window.innerHeight - margin * 2;
    const height = Math.min(panel.scrollHeight, maxHeight);
    setRect({
      left: Math.max(margin, Math.min(anchor.right + gap, window.innerWidth - RAIL_FLYOUT_WIDTH - margin)),
      top: Math.max(margin, Math.min(anchor.top - 6, window.innerHeight - height - margin)),
      maxHeight,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    const onScroll = (e: Event) => { if (e.target instanceof Node && panelRef.current?.contains(e.target)) return; close(); };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => (open ? close() : setOpen(true))}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          labeled
            ? `mt-1 flex h-6 items-center gap-2 rounded px-2 text-left text-small font-medium uppercase tracking-wider transition-colors ${
                open ? "text-text" : "text-faint hover:text-muted"
              }`
            : `mt-0.5 flex h-7 w-8 items-center justify-center rounded-md transition-colors ${
                open ? "bg-elevated text-text" : "text-faint hover:bg-elevated/60 hover:text-text"
              }`
        }
      >
        {labeled ? (
          <>
            <span className="flex w-4 shrink-0 items-center justify-center">{icon}</span>
            <span className="truncate">{label}</span>
          </>
        ) : (
          icon
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={label}
            style={{
              left: rect?.left,
              top: rect?.top,
              width: RAIL_FLYOUT_WIDTH,
              maxHeight: rect?.maxHeight,
              visibility: rect ? "visible" : "hidden",
            }}
            className="fixed z-50 overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-overlay p-1 shadow-xl shadow-black/10"
          >
            <div className="px-2 pb-1 pt-1 text-small font-medium uppercase tracking-wider text-faint">
              {label}
            </div>
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}

function RailFlyoutLink({
  href,
  active,
  icon,
  tag,
  onSelect,
  children,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  tag?: ReactNode;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body transition-colors ${
        active ? "bg-elevated text-text" : "text-text hover:bg-elevated"
      }`}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="truncate">{children}</span>
      {tag ? (
        <span className="ml-auto shrink-0 rounded-full border border-border px-1.5 py-px text-caption text-faint">
          {tag}
        </span>
      ) : null}
    </Link>
  );
}

// The sidebar folded down to icons, the way ChatGPT keeps its navigation reachable in a
// narrow column. Labels live in the tooltip; everything else matches the full sidebar.
// It renders the column's contents only — the shell owns the <aside> and the resize
// handle, so the handle survives the moment the drag crosses into or out of this look.
function SidebarRail({
  workspace,
  workspaces,
  unread,
  openTasks,
  reviewTasks,
  hidden,
  projects,
  favorites,
  favoritePages,
  pages,
  members,
  viewerId,
  width,
  agentAllowed,
}: {
  workspace: WorkspaceInfo;
  workspaces: WorkspaceInfo[];
  unread: number | null;
  openTasks: number;
  reviewTasks: number;
  hidden: string[];
  projects: Project[];
  favorites: Project[];
  favoritePages: PageRef[];
  pages: PageSummary[];
  members: Member[];
  viewerId: string;
  width: number;
  agentAllowed: boolean;
}) {
  const shownProjects=usePinned(projects,"project");
  const t = useT();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workspaceId = workspace.id;
  const view = searchParams.get("view") ?? "all";
  const assignee = searchParams.get("assignee") ?? "";
  const taskActive = (params: Record<string, string | undefined>) =>
    pathname === `/${workspaceId}` &&
    !searchParams.get("project") &&
    (params.view ?? "all") === view &&
    (params.assignee ?? "") === assignee;
  const allTasksActive =
    taskActive({ view: "all" }) ||
    taskActive({ view: "active" }) ||
    taskActive({ view: "agent" }) ||
    taskActive({ view: "all", assignee: "none" });
  const docRoots = pages.filter((page) => !page.parentId);
  const sharedDocs = docRoots.filter((page) => page.shared);
  const privateDocs = docRoots.filter((page) => !page.shared);
  // Dragging the rail wider turns it into a compact sidebar: labels appear, the
  // workspace chip regains its name, and everything lines up from the left edge.
  const {pins} = useUI();
  const labeled = width >= SIDEBAR_RAIL_LABEL_MIN;
  const named = width >= SIDEBAR_RAIL_NAME_MIN;
  const teamShown = !hidden.includes("team") && members.length > 0;
  const team = orderTeam(members, viewerId, workspace.createdBy);

  const divider = (
    <div
      aria-hidden
      className={`my-1.5 h-px shrink-0 bg-border ${labeled ? "w-full" : "w-6"}`}
    />
  );

  return (
    <>
      <div
        className={`flex h-12 shrink-0 items-center gap-0.5 ${labeled ? "px-2" : "justify-center"}`}
      >
        <WorkspaceSwitcher workspace={workspace} workspaces={workspaces} compact={!named} />
      </div>
      <nav
        className={
          labeled
            ? "flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-1"
            : "flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto px-1.5 py-1"
        }
      >
        <RailLink
          href={`/${workspaceId}/notifications`}
          active={pathname.endsWith("/notifications")}
          label={t("Inbox")}
          icon={<Inbox size={16} />}
          dot={(unread ?? 0) > 0}
          labeled={labeled}
        />
        <RailLink
          href={`/${workspaceId}/activity`}
          active={pathname.endsWith("/activity")}
          label={t("Activity")}
          icon={<Activity size={16} />}
          labeled={labeled}
        />
        <RailLink
          href={`/${workspaceId}/planning`}
          active={pathname.startsWith(`/${workspaceId}/planning`)}
          label={t("Planning")}
          icon={<CalendarRange size={16} />}
          labeled={labeled}
          testId="nav-planning"
        />
        <RailLink
          href={`/${workspaceId}/insights`}
          active={pathname.startsWith(`/${workspaceId}/insights`)}
          label={t("Insights")}
          icon={<ChartNoAxesColumn size={16} />}
          labeled={labeled}
          testId="nav-insights"
        />
        <RailLink
          href={`/${workspaceId}/search`}
          active={pathname.endsWith("/search")}
          label={t("Search")}
          icon={<Search size={16} />}
          labeled={labeled}
        />
        <RailLink
          href={`/${workspaceId}/agent`}
          active={pathname.endsWith("/agent")}
          label={t("Agent")}
          icon={<Bot size={16} />}
          labeled={labeled}
          disabled={!agentAllowed}
        />
        <RailFlyout label={t("Tasks")} icon={<LayoutList size={15} />} labeled={labeled}>
          {(close) => [
            <RailFlyoutLink
              key="mine"
              href={`/${workspaceId}/?view=all&assignee=me`}
              active={taskActive({ view: "all", assignee: "me" })}
              icon={<User size={14} />}
              onSelect={close}
            >
              {t("My Tasks")}
            </RailFlyoutLink>,
            <RailFlyoutLink
              key="open"
              href={`/${workspaceId}/?view=open`}
              active={taskActive({ view: "open" })}
              icon={<Hand size={14} />}
              tag={openTasks ? openTasks : undefined}
              onSelect={close}
            >
              {t("Open Tasks")}
            </RailFlyoutLink>,
            <RailFlyoutLink
              key="all"
              href={`/${workspaceId}/?view=all`}
              active={allTasksActive}
              icon={<List size={14} />}
              onSelect={close}
            >
              {t("All Tasks")}
            </RailFlyoutLink>,
            <RailFlyoutLink
              key="review"
              href={`/${workspaceId}/review`}
              active={pathname.endsWith("/review")}
              icon={<ShieldCheck size={14} />}
              tag={reviewTasks ? reviewTasks : undefined}
              onSelect={close}
            >
              {t("Review")}
            </RailFlyoutLink>,
          ]}
        </RailFlyout>
        {pins.length>0&&<RailFlyout label={t("Pinned")} icon={<Star size={15}/>} labeled={labeled}>{close=>pins.map(pin=><RailFlyoutLink key={`${pin.kind}:${pin.id}`} href={pin.href} active={false} icon={<Star size={13}/>} onSelect={close}>{pin.title}</RailFlyoutLink>)}</RailFlyout>}
        {/* Only the groups survive the fold, not their rows: each glyph raises a
            flyout with the group's names, leaving the column's width alone. */}
        {(favorites.length > 0 || favoritePages.length > 0 || projects.length > 0 || teamShown) && divider}
        {(favorites.length > 0 || favoritePages.length > 0) && (
          <RailFlyout label={t("Favorites")} icon={<Star size={15} />} labeled={labeled}>
            {(close) => [
              ...favorites.map((project) => (
                <RailFlyoutLink
                  key={project.id}
                  href={`/${workspaceId}/projects/${project.id}`}
                  active={pathname.startsWith(`/${workspaceId}/projects/${project.id}`)}
                  icon={<ProjectIcon color={project.color} icon={project.icon} size={14} />}
                  onSelect={close}
                >
                  {project.name}
                </RailFlyoutLink>
              )),
              ...favoritePages.map((page) => (
                <RailFlyoutLink
                  key={page.id}
                  href={`/${workspaceId}/docs/${page.id}`}
                  active={pathname === `/${workspaceId}/docs/${page.id}`}
                  icon={page.icon ?? <FileText size={13} />}
                  onSelect={close}
                >
                  {page.title}
                </RailFlyoutLink>
              )),
            ]}
          </RailFlyout>
        )}
        {projects.length > 0 && (
          <RailFlyout label={t("Projects")} icon={<Boxes size={15} />} labeled={labeled}>
            {(close) =>
              shownProjects.map((project) => (
                <RailFlyoutLink
                  key={project.id}
                  href={`/${workspaceId}/projects/${project.id}`}
                  active={pathname.startsWith(`/${workspaceId}/projects/${project.id}`)}
                  icon={<ProjectIcon color={project.color} icon={project.icon} size={14} />}
                  onSelect={close}
                >
                  {project.name}
                </RailFlyoutLink>
              ))
            }
          </RailFlyout>
        )}
        <RailFlyout label={t("Documents")} icon={<FileText size={15} />} labeled={labeled}>
          {(close) => [
            <RailFlyoutLink
              key="library"
              href={`/${workspaceId}/docs`}
              active={pathname === `/${workspaceId}/docs`}
              icon={<FileText size={14} />}
              onSelect={close}
            >
              {t("Documents")}
            </RailFlyoutLink>,
            ...(sharedDocs.length > 0
              ? [
                  <div key="shared-head" className="px-2 pb-0.5 pt-1 text-caption uppercase tracking-wide text-faint">
                    {t("Shared")}
                  </div>,
                  ...sharedDocs.map((page) => (
                    <RailFlyoutLink
                      key={page.id}
                      href={`/${workspaceId}/docs/${page.id}`}
                      active={pathname === `/${workspaceId}/docs/${page.id}`}
                      icon={page.icon ?? <FileText size={13} />}
                      onSelect={close}
                    >
                      {page.title || t("Untitled")}
                    </RailFlyoutLink>
                  )),
                ]
              : []),
            ...(privateDocs.length > 0
              ? [
                  <div key="private-head" className="px-2 pb-0.5 pt-1 text-caption uppercase tracking-wide text-faint">
                    {t("Private")}
                  </div>,
                  ...privateDocs.map((page) => (
                    <RailFlyoutLink
                      key={page.id}
                      href={`/${workspaceId}/docs/${page.id}`}
                      active={pathname === `/${workspaceId}/docs/${page.id}`}
                      icon={page.icon ?? <FileText size={13} />}
                      onSelect={close}
                    >
                      {page.title || t("Untitled")}
                    </RailFlyoutLink>
                  )),
                ]
              : []),
          ]}
        </RailFlyout>
        {teamShown && (
          <RailFlyout label={t("Your team")} icon={<Users size={15} />} labeled={labeled}>
            {(close) =>
              team.map((member) => (
                <RailFlyoutLink
                  key={member.id}
                  href={`/${workspaceId}/people/${member.id}`}
                  active={pathname === `/${workspaceId}/people/${member.id}`}
                  icon={
                    <AssigneeAvatar
                      displayName={member.displayName}
                      avatar={member.avatar}
                      size={16}
                    />
                  }
                  tag={member.id === workspace.createdBy ? t("Owner") : undefined}
                  onSelect={close}
                >
                  {member.displayName}
                </RailFlyoutLink>
              ))
            }
          </RailFlyout>
        )}
      </nav>
      <div
        className={
          labeled
            ? "flex flex-col gap-0.5 border-t border-border px-2 py-2"
            : "flex flex-col items-center gap-1 border-t border-border px-1.5 py-2"
        }
      >
        {!hidden.includes("help") && (
          <RailLink
            href={`/${workspaceId}/help`}
            active={pathname.endsWith("/help")}
            label={t("Help")}
            icon={<CircleHelp size={16} />}
            labeled={labeled}
          />
        )}
        <RailLink
          href={`/${workspaceId}/trash`}
          active={pathname.endsWith("/trash")}
          label={t("Trash")}
          icon={<Trash2 size={16} />}
          labeled={labeled}
        />
        <RailLink
          href={`/${workspaceId}/settings`}
          active={pathname.endsWith("/settings")}
          label={t("Settings")}
          icon={<Settings size={16} />}
          labeled={labeled}
        />
      </div>
    </>
  );
}

const TABS_KEY = "tacos.tabs.v1";
const SIDEBAR_KEY = "tacos.sidebar.collapsed";
const SIDEBAR_WIDTH_KEY = "tacos.sidebar.width";
const SIDEBAR_RAIL_WIDTH_KEY = "tacos.sidebar.railwidth";
// Sections the sidebar can show or hide; the customize menu edits this list.
const HIDDEN_KEY = "tacos.sidebar.hidden";
// Pre-rail key: it listed the extras that were ON. Kept only to carry old choices over.
const LEGACY_OPTIONAL_KEY = "tacos.sidebar.optional";
const SIDEBAR_SECTIONS = [{ key: "help", label: "Help", icon: CircleHelp }] as const;
// Help is part of the sidebar until someone takes it out.
const DEFAULT_HIDDEN: string[] = [];
const SIDEBAR_DEFAULT = 216;
// The one drag runs the whole way: SIDEBAR_MIN is where the full sidebar gives up and
// the column turns into the icon rail, so pulling it in from a normal sidebar folds it
// down to icons without letting go of the handle. Inside the rail, dragging wider is how
// you get words back — past SIDEBAR_RAIL_LABEL_MIN the items grow their labels, past
// SIDEBAR_RAIL_NAME_MIN the workspace chip does too — and past SIDEBAR_RAIL_MAX the
// column is the full sidebar again.
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 420;
const SIDEBAR_CONTENT_MIN = 480;
// The rail only holds 32px targets, so 48px is enough and 44px is the floor.
const SIDEBAR_RAIL = 48;
const SIDEBAR_RAIL_MIN = 44;
const SIDEBAR_RAIL_MAX = SIDEBAR_MIN - 1;
// 128 fits the longest label (t("Documents")) plus the icon, the gap and both paddings,
// so a label never arrives already cut off with an ellipsis.
const SIDEBAR_RAIL_LABEL_MIN = 128;
const SIDEBAR_RAIL_NAME_MIN = 176;

// The sidebar width is a per-device preference, not workspace data: the same account
// on a laptop and a wide display wants different numbers. Restored after mount so the
// server markup and the first client render agree.
//
// One width holds both looks — the column is the icon rail while it is under
// SIDEBAR_MIN and the full sidebar above it — so a single drag can cross from one to the
// other. Each look still remembers its own width, so the header button and a reload put
// the column back the way that mode was left instead of dumping you at the boundary.
function useSidebarWidth() {
  const [width, setWidth] = useState(SIDEBAR_DEFAULT);
  const [available,setAvailable]=useState<number|null>(null);
  useEffect(()=>{const measure=()=>setAvailable(document.documentElement.clientWidth);const observer=new ResizeObserver(measure);observer.observe(document.documentElement);measure();return()=>observer.disconnect();},[]);
  const lastFull = useRef(SIDEBAR_DEFAULT);
  const lastRail = useRef(SIDEBAR_RAIL);

  useEffect(() => {
    try {
      const savedFull = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
      if (Number.isFinite(savedFull) && savedFull > 0) {
        lastFull.current = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, savedFull));
      }
      const savedRail = Number(window.localStorage.getItem(SIDEBAR_RAIL_WIDTH_KEY));
      if (Number.isFinite(savedRail) && savedRail > 0) {
        // Clamped, not rejected: narrower builds let the rail grow past its current
        // ceiling, and sending those users back to the default width would be a surprise.
        lastRail.current = Math.min(SIDEBAR_RAIL_MAX, Math.max(SIDEBAR_RAIL_MIN, savedRail));
      }
      // The old key meant "hidden", so "1" already reads as the compact state.
      setWidth(window.localStorage.getItem(SIDEBAR_KEY) === "1" ? lastRail.current : lastFull.current);
    } catch {
      /* storage unavailable — keep the defaults */
    }
  }, []);

  const remember = useCallback((value: number, compact: boolean) => {
    try {
      window.localStorage.setItem(compact ? SIDEBAR_RAIL_WIDTH_KEY : SIDEBAR_WIDTH_KEY, String(value));
      window.localStorage.setItem(SIDEBAR_KEY, compact ? "1" : "0");
    } catch {
      /* storage unavailable — the width still applies to this page view */
    }
  }, []);

  // Stable so the drag effect does not re-subscribe on every pixel. It only moves the
  // column; what was chosen is recorded on release, because a drag that ends in the rail
  // has passed through the full sidebar's widths on its way in and must not leave the
  // last of those behind as "the" full width.
  const resize = useCallback((next: number) => {
    setWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_RAIL_MIN, next)));
  }, []);

  const commit = useCallback(
    (next: number) => {
      const value = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_RAIL_MIN, next));
      const compact = value < SIDEBAR_MIN;
      if (compact) lastRail.current = value;
      else lastFull.current = value;
      remember(value, compact);
    },
    [remember]
  );

  // The header button jumps between the two looks rather than stepping pixels. Collapsing
  // always lands on the minimum rail: "collapse" reads as "get out of the way", so a rail
  // that was once dragged wide enough to show labels must not come back instead. Expanding
  // still restores the width the full sidebar was left at.
  const toggle = useCallback(() => {
    setWidth((current) => {
      const compact = current >= SIDEBAR_MIN;
      if (!compact) {
        remember(lastFull.current, false);
        return lastFull.current;
      }
      lastRail.current = SIDEBAR_RAIL;
      remember(SIDEBAR_RAIL, true);
      return SIDEBAR_RAIL;
    });
  }, [remember]);

  const rendered=available===null?width:Math.min(width,Math.max(SIDEBAR_RAIL_MIN,available-SIDEBAR_CONTENT_MIN));
  return { width:rendered, rail: rendered < SIDEBAR_MIN, resize, commit, toggle };
}

/**
 * Drag handle sitting on the sidebar's right border. The move/up listeners live on
 * `window` because the strip is only 6px wide and slides out from under the cursor as
 * soon as the sidebar grows.
 */
function SidebarResizer({
  width,
  min,
  max,
  resetTo,
  onWidth,
  onDone,
}: {
  width: number;
  min: number;
  max: number;
  resetTo: number;
  onWidth: (next: number) => void;
  onDone: (next: number) => void;
}) {
  const t = useT();
  const [dragging, setDragging] = useState(false);
  const origin = useRef({ x: 0, width: 0 });
  // The width the pointer last produced: releasing decides what to remember, and a
  // press without a move means "the width it already has".
  const latest = useRef(width);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const next = origin.current.width + e.clientX - origin.current.x;
      // Whatever the sidebar takes, the content card keeps room to work in.
      const room = Math.max(min, Math.min(max, window.innerWidth - SIDEBAR_CONTENT_MIN));
      latest.current = Math.min(room, Math.max(min, next));
      onWidth(latest.current);
    };
    const stop = () => {
      onDone(latest.current);
      setDragging(false);
    };
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
  }, [dragging, max, min, onDone, onWidth]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("Resize sidebar")}
      title={t("Drag to resize, double-click to reset")}
      onPointerDown={(e) => {
        e.preventDefault();
        origin.current = { x: e.clientX, width };
        latest.current = width;
        setDragging(true);
      }}
      onDoubleClick={() => {
        onWidth(resetTo);
        onDone(resetTo);
      }}
      className="group absolute -right-[11px] top-0 z-20 flex h-full w-[15px] cursor-col-resize touch-none justify-end"
    >
      {/* The line people see is the content card's border, across the gutter from this
          column, so the handle reaches over to it. Hover only hints at the boundary; the
          strong line belongs to the drag itself. */}
      <div
        className={`mr-[2px] h-full w-0.5 transition-colors ${
          dragging ? "bg-accent/45" : "group-hover:bg-accent/25"
        }`}
      />
    </div>
  );
}

function tabMeta(
  key: string,
  workspace: WorkspaceInfo,
  projects: Project[],
  members: Member[],
  pages: PageSummary[],
  t: Translate
) {
  const [pathname, query = ""] = key.split("?");
  const params = new URLSearchParams(query);
  const view = params.get("view") ?? "all";
  if (pathname === `/${workspace.id}`) {
    const assignee = params.get("assignee");
    if (view === "all" && assignee === "me") return { label: t("My Tasks"), icon: <User size={13} /> };
    if (view === "all" && assignee === "none")
      return { label: t("Unassigned"), icon: <UserRoundX size={13} /> };
    if (view === "all" && assignee) {
      const member = members.find((m) => m.id === assignee);
      if (member)
        return {
          label: member.displayName,
          // The generic person glyph stands for "me" (My Tasks); a named person's tab
          // shows their own face so two teammate tabs are told apart at a glance.
          icon: (
            <AssigneeAvatar displayName={member.displayName} avatar={member.avatar} size={16} />
          ),
        };
    }
    const projectId = params.get("project");
    if (view === "all" && projectId) {
      const project = projects.find((p) => p.id === projectId);
      if (project) return { label: project.name, icon: <ProjectIcon color={project.color} icon={project.icon} size={13} /> };
    }
    const status = STATUS_ORDER.find((s) => s === view);
    if (status)
      return { label: t(STATUS_META[status].label), icon: <StatusIcon status={status} size={13} /> };
    if (view === "active") return { label: t("Active"), icon: <Activity size={13} /> };
    if (view === "agent") return { label: t("Agent tasks"), icon: <Bot size={13} /> };
    if (view === "open") return { label: t("Open Tasks"), icon: <Hand size={13} /> };
    return { label: t("All Tasks"), icon: <List size={13} /> };
  }
  const personPage = pathname.match(new RegExp(`^/${workspace.id}/people/([^/]+)$`));
  if (personPage) {
    const member = members.find((m) => m.id === personPage[1]);
    return member
      ? {
          label: member.displayName,
          icon: (
            <AssigneeAvatar displayName={member.displayName} avatar={member.avatar} size={16} />
          ),
        }
      : { label: t("Person"), icon: <User size={13} /> };
  }
  const projectPage = pathname.match(new RegExp(`^/${workspace.id}/projects/([^/]+)(?:/issues)?$`));
  if (projectPage) {
    const project = projects.find((p) => p.id === projectPage[1]);
    if (project)
      return { label: project.name, icon: <ProjectIcon color={project.color} icon={project.icon} size={13} /> };
    return { label: t("Project"), icon: <ProjectIcon color={DEFAULT_PROJECT_COLOR} size={13} /> };
  }
  if (pathname.endsWith("/settings")) return { label: t("Settings"), icon: <Settings size={13} /> };
  if (pathname.endsWith("/agent")) return { label: t("Agent"), icon: <Bot size={13} /> };
  if (pathname.endsWith("/labels")) return { label: t("Labels"), icon: <Tag size={13} /> };
  if (pathname.endsWith("/trash")) return { label: t("Trash"), icon: <Trash2 size={13} /> };
  if (pathname.endsWith("/review")) return { label: t("Review"), icon: <ShieldCheck size={13} /> };
  if (pathname.endsWith("/help")) return { label: t("Help"), icon: <CircleHelp size={13} /> };
  if (pathname.endsWith("/activity"))
    return { label: t("Activity"), icon: <Activity size={13} /> };
  if (pathname.endsWith("/notifications"))
    return { label: t("Inbox"), icon: <Inbox size={13} /> };
  const docPage = pathname.match(new RegExp(`^/${workspace.id}/docs/([^/]+)$`));
  if (docPage) {
    const page = pages.find((candidate) => candidate.id === docPage[1]);
    return page
      ? { label: page.title, icon: <span>{page.icon ?? <FileText size={13} />}</span> }
      : { label: t("Doc"), icon: <FileText size={13} /> };
  }
  if (pathname === `/${workspace.id}/docs`) return { label: t("Documents"), icon: <FileText size={13} /> };
  return { label: t("Tasks"), icon: <List size={13} /> };
}

function TabBar({
  workspace,
  projects,
  members,
  pages,
  user,
  rail,
  sidebarWidth,
  onToggleRail,
}: {
  workspace: WorkspaceInfo;
  projects: Project[];
  members: Member[];
  pages: PageSummary[];
  user: UserInfo;
  rail: boolean;
  sidebarWidth: number;
  onToggleRail: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setPaletteOpen, scope } = useUI();
  const modifier=usePrimaryModifier();
  const [recentTabs,setRecentTabs]=useStoredJson<string[]>(`tacos.tabs.closed.${scope}`,[]);
  const [fixedTabs,setFixedTabs]=useStoredJson<string[]>(`tacos.tabs.fixed.${scope}`,[]);
  const [tabs, setTabs] = useState<string[] | null>(null);
  const justClosed = useRef<string | null>(null);
  // Closing a tab returns to the page it was opened from, not to whichever tab happens to
  // sit next to it in the strip — a doc opened from an Overview goes back to that Overview.
  const cameFrom = useRef<string | null>(null);
  const lastKey = useRef<string | null>(null);
  // Where the app sits when nothing is open. It is deliberately not a tab: the strip
  // is empty, and this page offers the ways back in.
  const startKey = `/${workspace.id}/start`;

  const keyParams = new URLSearchParams(searchParams.toString());
  keyParams.sort();
  const qs = keyParams.toString();
  const current = `${pathname}${qs ? `?${qs}` : ""}`;
  const sameTab = (a: string, b: string) => tabIdentity(a) === tabIdentity(b);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(`${TABS_KEY}.${scope}`) ?? "[]");
      const keys: string[] = Array.isArray(saved) ? saved.filter((t) => typeof t === "string") : [];
      setTabs(keys.filter((key, i) => keys.findIndex((other) => sameTab(other, key)) === i));
    } catch {
      setTabs([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  useEffect(() => {
    if (lastKey.current !== current) {
      cameFrom.current = lastKey.current;
      lastKey.current = current;
    }
  }, [current]);

  useEffect(() => {
    if (tabs === null) return;
    // Closing the page you are on drops its tab before the router lands somewhere else;
    // during that gap the old URL must not be added straight back. Once the route has
    // actually moved on the guard is spent, so revisiting the page later opens it again.
    if (justClosed.current !== null && current !== justClosed.current) justClosed.current = null;
    if (current === justClosed.current) return;
    if (current === startKey) return;
    if (tabs.includes(current)) return;
    const existing = tabs.findIndex((key) => sameTab(key, current));
    if (existing >= 0) {
      setTabs(tabs.map((key, i) => (i === existing ? current : key)));
      return;
    }
    setTabs([...tabs, current]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, tabs]);

  useEffect(() => {
    if (tabs === null) return;
    try {
      window.localStorage.setItem(`${TABS_KEY}.${scope}`, JSON.stringify(tabs));
    } catch {
      /* storage unavailable — tabs still work for this window */
    }
  }, [tabs, workspace.id]);

  // Projects and pages can vanish outside this window (another device, a purge). A
  // restored tab for one of them would only redirect or 404, so drop it on sight.
  useEffect(() => {
    if (tabs === null) return;
    const liveProjects = new Set(projects.map((project) => project.id));
    const livePages = new Set(pages.map((page) => page.id));
    const alive = (key: string) => {
      const project = key.match(new RegExp(`^/${workspace.id}/projects/([^/?]+)`));
      if (project && !liveProjects.has(project[1])) return false;
      const page = key.match(new RegExp(`^/${workspace.id}/docs/([^/?]+)`));
      if (page && !livePages.has(page[1])) return false;
      return true;
    };
    if (tabs.every(alive)) return;
    setTabs(tabs.filter(alive));
  }, [tabs, projects, pages, workspace.id]);

  const visible = tabs ?? [];

  function closeTab(key: string) {
    if(fixedTabs.includes(key))return;
    setRecentTabs(previous=>[key,...previous.filter(item=>item!==key)].slice(0,20));
    const index = visible.indexOf(key);
    const rest = visible.filter((t) => t !== key);
    setTabs(rest);
    if (key !== current) return;
    justClosed.current = key;
    // The tab this one was opened from is the way back; a strip neighbour is only the
    // fallback when that tab has been closed too. Closing the last tab leaves nothing to
    // show, so the workspace falls back to the start page instead of All Tasks.
    const back =
      cameFrom.current && cameFrom.current !== key && rest.includes(cameFrom.current)
        ? cameFrom.current
        : rest[Math.max(0, Math.min(index, rest.length - 1))];
    router.push(back ?? startKey);
  }

  function closeMany(key:string,right:boolean) {
    const keep=visible.filter((item,index)=>fixedTabs.includes(item)||(right?index<=visible.indexOf(key):item===key));
    setTabs(keep);setRecentTabs(previous=>[...visible.filter(item=>!keep.includes(item)),...previous].slice(0,20));
    if(!keep.includes(current))router.push(key);
  }

  // A deleted doc must not leave a dead route in the strip: drop its tab (and any
  // subpage tabs that went with it) and activate the neighbour, like closing a tab.
  useEffect(() => {
    const onDocsDeleted = (event: Event) => {
      const pageIds = (event as CustomEvent<{ pageIds?: string[] }>).detail?.pageIds;
      if (!pageIds?.length || tabs === null) return;
      const dead = new Set(pageIds);
      const pattern = new RegExp(`^/${workspace.id}/docs/([^/?]+)`);
      const isDead = (key: string) => {
        const match = key.match(pattern);
        return Boolean(match && dead.has(match[1]));
      };
      const index = tabs.findIndex(isDead);
      if (index < 0) return;
      const rest = tabs.filter((key) => !isDead(key));
      justClosed.current = tabs[index];
      setTabs(rest);
      if (isDead(current)) router.push(rest[Math.max(0, Math.min(index, rest.length - 1))] ?? startKey);
    };
    window.addEventListener(DOCS_DELETED_EVENT, onDocsDeleted);
    return () => window.removeEventListener(DOCS_DELETED_EVENT, onDocsDeleted);
  }, [tabs, workspace.id, startKey, router, current]);

  return (
    <header className="app-windowbar flex h-12 shrink-0 items-center bg-surface pr-3">
      {/* Same width as the sidebar, so the tabs line up with the content column. */}
      <div
        style={{ width: sidebarWidth }}
        data-rail={rail ? "true" : undefined}
        className="app-windowbar-left flex shrink-0 items-center px-3"
      >
        <button
          type="button"
          onClick={onToggleRail}
          title={rail ? t("Expand sidebar") : t("Collapse to icons")}
          aria-label={rail ? t("Expand sidebar") : t("Collapse to icons")}
          className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-elevated hover:text-text"
        >
          {rail ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <div className="app-tabstrip flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pl-1.5">
        {visible.map((key) => {
          const { label, icon } = tabMeta(key, workspace, projects, members, pages, t);
          const isActive = key === current;
          return (
            <ContextMenu.Root key={key}><ContextMenu.Trigger asChild><div
              className={`app-tab group flex h-8 w-[128px] shrink-0 min-w-0 items-center gap-1.5 rounded-lg border px-2 text-small transition-colors ${
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
                <span className="truncate">{fixedTabs.includes(key)?"• ":""}{label}</span>
              </button>
              <button disabled={fixedTabs.includes(key)}
                type="button"
                onClick={() => closeTab(key)}
                aria-label={t("Close {label}", { label })}
                className={`shrink-0 rounded p-0.5 text-faint transition-opacity hover:bg-elevated hover:text-text ${
                  isActive ? "opacity-70" : "opacity-0 group-hover:opacity-70"
                }`}
              >
                <X size={12} />
              </button>
            </div></ContextMenu.Trigger><ContextMenu.Portal><ContextMenu.Content className="z-[90] rounded-lg border border-border bg-overlay p-1 text-body shadow-lg">
              <ContextMenu.Item onSelect={()=>setFixedTabs(previous=>previous.includes(key)?previous.filter(item=>item!==key):[...previous,key])} className="rounded px-3 py-1.5 data-[highlighted]:bg-elevated">{t(fixedTabs.includes(key)?"Unpin tab":"Pin tab")}</ContextMenu.Item>
              <ContextMenu.Item disabled={fixedTabs.includes(key)} onSelect={()=>closeTab(key)} className="rounded px-3 py-1.5 data-[highlighted]:bg-elevated">{t("Close tab")}</ContextMenu.Item>
              <ContextMenu.Item onSelect={()=>closeMany(key,false)} className="rounded px-3 py-1.5 data-[highlighted]:bg-elevated">{t("Close other tabs")}</ContextMenu.Item>
              <ContextMenu.Item onSelect={()=>closeMany(key,true)} className="rounded px-3 py-1.5 data-[highlighted]:bg-elevated">{t("Close tabs to the right")}</ContextMenu.Item>
            </ContextMenu.Content></ContextMenu.Portal></ContextMenu.Root>
          );
        })}
      </div>

      <Menu align="right" width={300} trigger={<span aria-label={t("Open tabs")}>▾</span>} triggerClassName="rounded px-2 py-1 text-muted">{close=><>{visible.map(key=><MenuItem key={key} onSelect={()=>{close();router.push(key);}}>{tabMeta(key,workspace,projects,members,pages,t).label}</MenuItem>)}{recentTabs.length>0&&<div className="border-t border-border px-2 py-1 text-small text-faint">{t("Recently closed")}</div>}{recentTabs.map(key=><MenuItem key={key} onSelect={()=>{close();setRecentTabs(previous=>previous.filter(item=>item!==key));router.push(key);}}>{tabMeta(key,workspace,projects,members,pages,t).label}</MenuItem>)}</>}</Menu>

      <DesktopAppUpdateButton />

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        title={t("Open something ({key}K)",{key:modifier})}
        aria-label={t("Open something")}
        className="ml-1.5 shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-elevated hover:text-text"
      >
        <Plus size={16} />
      </button>

      <div className="ml-1 flex shrink-0 items-center gap-1">
        <UserMenu
          user={user}
          adminUrl={
            user.siteRole === "admin"
              ? "/admin"
              : workspace.role === "admin"
                ? `/admin/${workspace.id}`
                : null
          }
        />
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
  favoritePages,
  members,
  pages,
  joinCode,
  agentAllowed,
  openTasks,
  reviewTasks,
  children,
}: {
  workspace: WorkspaceInfo;
  user: UserInfo;
  workspaces: WorkspaceInfo[];
  projects: Project[];
  favorites: Project[];
  favoritePages: PageRef[];
  members: Member[];
  pages: PageSummary[];
  joinCode: string | null;
  agentAllowed: boolean;
  openTasks: number;
  reviewTasks: number;
  children: ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  // G then I opens the Inbox from anywhere, like Linear.
  useEffect(() => {
    let waiting = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)
      ) {
        waiting = false;
        return;
      }
      if (waiting && (event.key === "i" || event.key === "I")) {
        waiting = false;
        if (timer) clearTimeout(timer);
        event.preventDefault();
        router.push(`/${workspace.id}/notifications`);
        return;
      }
      waiting = event.key === "g" || event.key === "G";
      if (timer) clearTimeout(timer);
      if (waiting) timer = setTimeout(() => { waiting = false; }, 1200);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer) clearTimeout(timer);
    };
  }, [router, workspace.id]);
  // One width, two looks, like ChatGPT: under SIDEBAR_MIN the column is the icon rail.
  const {
    width: sidebarWidth,
    rail,
    resize: resizeSidebar,
    commit: commitSidebar,
    toggle: toggleRail,
  } = useSidebarWidth();
  const unread = useUnreadNotifications(workspace.id);
  const [hiddenSections, setHiddenSections] = useState<string[]>(DEFAULT_HIDDEN);
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HIDDEN_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved)) {
          setHiddenSections(
            saved.filter(
              (key) =>
                typeof key === "string" && key !== "labels" && key !== "workspace" && key !== "tasks"
            )
          );
        }
      } else {
        // Carry over the pre-rail list, which named the extras that were visible. No
        // list at all means a fresh account, so the defaults above stand.
        const legacyRaw = window.localStorage.getItem(LEGACY_OPTIONAL_KEY);
        const legacy = legacyRaw ? JSON.parse(legacyRaw) : null;
        if (Array.isArray(legacy)) {
          const shown = legacy.filter((key) => typeof key === "string");
          // Help had no switch back then — it was always in the sidebar.
          if (!shown.includes("help")) shown.push("help");
          setHiddenSections(SIDEBAR_SECTIONS.map((s) => s.key).filter((key) => !shown.includes(key)));
        }
      }
    } catch {
      /* storage unavailable — keep the defaults */
    }
  }, []);

  function toggleSection(key: string) {
    setHiddenSections((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — the choice still applies to this page view */
      }
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col">
      <DesktopOpenFiles workspaceId={workspace.id} />
      <Suspense fallback={<div className="h-12 shrink-0 bg-surface" />}>
        <TabBar
          workspace={workspace}
          projects={projects}
          members={members}
          pages={pages}
          user={user}
          rail={rail}
          sidebarWidth={sidebarWidth}
          onToggleRail={toggleRail}
        />
      </Suspense>

      <div className="flex min-h-0 flex-1 bg-surface">
        {/*
          One column, one handle: the same drag runs from the full sidebar down to the
          icon rail, so the <aside> and its resizer stay mounted while the contents swap
          between the two looks. Unmounting them would drop the pointer mid-drag.
        */}
        <aside
          style={{ width: sidebarWidth }}
          className="relative flex shrink-0 flex-col bg-surface"
        >
          {rail ? (
            <SidebarRail
              workspace={workspace}
              workspaces={workspaces}
              unread={unread}
              openTasks={openTasks}
              reviewTasks={reviewTasks}
              hidden={hiddenSections}
              projects={projects}
              favorites={favorites}
              favoritePages={favoritePages}
              pages={pages}
              members={members}
              viewerId={user.id}
              width={sidebarWidth}
              agentAllowed={agentAllowed}
            />
          ) : (
            <>
              <div className="flex h-12 shrink-0 items-center px-3">
                <WorkspaceSwitcher workspace={workspace} workspaces={workspaces} />
              </div>

              <Suspense fallback={<nav className="flex-1 px-2 py-3" />}>
                <SidebarNav
                  workspace={workspace}
                  projects={projects}
                  favorites={favorites}
                  favoritePages={favoritePages}
                  pages={pages}
                  members={members}
                  viewerId={user.id}
                  unread={unread}
                  openTasks={openTasks}
                  reviewTasks={reviewTasks}
                  hidden={hiddenSections}
                  width={sidebarWidth}
                  agentAllowed={agentAllowed}
                  onToggleSection={toggleSection}
                  onInvite={() => setInviteOpen(true)}
                />
              </Suspense>

              <div data-sidebar-footer className="space-y-0.5 border-t border-border px-2 py-2">
                {!hiddenSections.includes("help") && (
                  <NavItem
                    href={`/${workspace.id}/help`}
                    active={pathname.endsWith("/help")}
                    icon={<CircleHelp size={14} />}
                  >
                    {t("Help")}
                  </NavItem>
                )}
                <NavItem
                  href={`/${workspace.id}/trash`}
                  active={pathname.endsWith("/trash")}
                  icon={<Trash2 size={14} />}
                >
                  {t("Trash")}
                </NavItem>
                <NavItem
                  href={`/${workspace.id}/settings`}
                  active={pathname.endsWith("/settings")}
                  icon={<Settings size={14} />}
                >
                  {t("Settings")}
                </NavItem>
              </div>
            </>
          )}

          {/* The handle spans both looks and resets to whichever one is on screen. */}
          <SidebarResizer
            width={sidebarWidth}
            min={SIDEBAR_RAIL_MIN}
            max={SIDEBAR_MAX}
            resetTo={rail ? SIDEBAR_RAIL : SIDEBAR_DEFAULT}
            onWidth={resizeSidebar}
            onDone={commitSidebar}
          />
        </aside>

        {/*
          Linear frames the workspace as a panel: the sidebar and the tab bar share one
          grey surface, and everything you are actually working on sits in a white card
          with its own border and rounded corners, floating in a small gutter.
        */}
        <main className="flex min-w-0 flex-1 flex-col p-2 pt-1">
          {/* The list and the issue are separate cards with a gutter, the way Linear
              splits a view from its detail pane — not one card cut by a divider. */}
          <DetailLayout detail={<><IssuePanelHost workspaceId={workspace.id} currentUserId={user.id} /><DocPanelHost workspaceId={workspace.id} /></>}>
            {children}
          </DetailLayout>
        </main>
      </div>

      <LiveRefresh workspaceId={workspace.id} />
      {inviteOpen && (
        <InviteDialog
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          isAdmin={workspace.role === "admin"}
          joinCode={joinCode}
          onClose={() => setInviteOpen(false)}
        />
      )}
    </div>
  );
}
