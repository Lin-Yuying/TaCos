"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Activity, ChevronDown, FileText, FolderKanban, ListChecks } from "lucide-react";
import { AssigneeAvatar } from "@/components/issue-table";
import { useUI } from "@/components/ui-context";
import { useLiveTick } from "@/components/live-refresh";
import { loadActivityAction } from "@/app/activity-actions";
import { actorName, eventText } from "@/components/issue-panel/format";
import { timeAgo } from "@/lib/format";
import type { Locale, Translate } from "@/lib/i18n";
import type { ActivityObjectType, ActivityScope, WorkspaceActivityItem, WorkspaceActivityPage } from "@/lib/activity";
import type { Member } from "@/lib/issues";
import { useLocale, useT } from "@/components/i18n-context";
import { PAGE_HEADER, PAGE_INSET, PAGE_TITLE } from "@/lib/page-chrome";

type ProjectOption = { id: string; name: string; color: string; icon: string | null };

const SCOPES: { id: ActivityScope; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mine", label: "My activity" },
  { id: "following", label: "Following" },
];

const OBJECT_TYPES: { id: ActivityObjectType | ""; label: string }[] = [
  { id: "", label: "All types" },
  { id: "task", label: "Tasks" },
  { id: "document", label: "Documents" },
  { id: "project", label: "Projects" },
];

function objectText(item: WorkspaceActivityItem, t: Translate): string {
  switch (item.type) {
    case "page_created":
      return t("created the document");
    case "page_renamed":
      return t("renamed the document");
    case "page_icon_changed":
      return t("changed the document icon");
    case "page_shared":
      return t("shared the document");
    case "page_private":
      return t("made the document private");
    case "page_commented":
      return t("commented on the document");
    case "page_comment_resolved":
      return t("resolved a comment thread");
    case "page_comment_reopened":
      return t("reopened a comment thread");
    case "project_created":
      return t("created the project");
    case "project_renamed":
      return t("renamed the project");
    case "project_updated":
      return t("updated the project");
    case "project_commented":
      return t("commented on the project");
    default:
      return "";
  }
}

function sentence(item: WorkspaceActivityItem, t: Translate, locale: Locale): string {
  if (item.objectType === "task") {
    const phrase = eventText(
      {
        id: item.id,
        issueId: item.issueId ?? "",
        type: item.type,
        data: item.data,
        actor: item.actor
          ? { id: item.actor.id, username: "", displayName: item.actor.displayName, avatar: item.actor.avatar }
          : null,
        agentActor: item.agentActor,
        createdAt: item.createdAt,
      },
      t,
      locale
    );
    if (phrase) return phrase;
  }
  return objectText(item, t) || item.type.replaceAll("_", " ");
}

function dayKey(iso: string): string {
  // Group by the viewer's local calendar day, not the UTC date prefix: an evening
  // event in UTC+ offsets must not start a second "Today" group.
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayLabel(iso: string, locale: Locale, t: Translate): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return t("Today");
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, yesterday)) return t("Yesterday");
  return date.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

export function ActivityView({
  workspaceId,
  initialPage,
  projects,
  members,
  initialScope,
  initialType,
  initialProject,
  initialPerson,
}: {
  workspaceId: string;
  initialPage: WorkspaceActivityPage;
  projects: ProjectOption[];
  members: Member[];
  initialScope: ActivityScope;
  initialType: ActivityObjectType | "";
  initialProject: string;
  initialPerson: string;
}) {
  const t = useT();
  const locale = useLocale();
  const { openIssue, openPage } = useUI();
  const live = useLiveTick();
  const [items, setItems] = useState(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [scope, setScope] = useState<ActivityScope>(initialScope);
  const [objectType, setObjectType] = useState<ActivityObjectType | "">(initialType);
  const [projectId, setProjectId] = useState(initialProject);
  const [personId, setPersonId] = useState(initialPerson);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const lastLive = useRef(0);

  const query = useCallback(
    (cursor?: string | null) => ({
      scope,
      objectType: objectType || undefined,
      projectId: projectId || undefined,
      personId: personId || undefined,
      cursor: cursor ?? null,
    }),
    [scope, objectType, projectId, personId]
  );

  const syncUrl = useCallback(
    (next: { scope: ActivityScope; type: ActivityObjectType | ""; project: string; person: string }) => {
      const url = new URL(window.location.href);
      if (next.scope === "all") url.searchParams.delete("scope");
      else url.searchParams.set("scope", next.scope);
      if (next.type) url.searchParams.set("type", next.type);
      else url.searchParams.delete("type");
      if (next.project) url.searchParams.set("project", next.project);
      else url.searchParams.delete("project");
      if (next.person) url.searchParams.set("person", next.person);
      else url.searchParams.delete("person");
      window.history.replaceState(null, "", url);
    },
    []
  );

  const loadFirst = useCallback(
    async (nextQuery = { scope, objectType, projectId, personId }) => {
      const seq = ++generation.current;
      setLoading(true);
      try {
        const result = await loadActivityAction(workspaceId, {
          scope: nextQuery.scope,
          objectType: nextQuery.objectType || undefined,
          projectId: nextQuery.projectId || undefined,
          personId: nextQuery.personId || undefined,
          cursor: null,
        });
        if (seq !== generation.current) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setItems(result.data.items);
        setNextCursor(result.data.nextCursor);
        setError(null);
      } catch {
        if (seq === generation.current) setError(t("Could not load activity. Retry."));
      } finally {
        if (seq === generation.current) setLoading(false);
      }
    },
    [workspaceId, scope, objectType, projectId, personId, t]
  );

  // Live refresh keeps the first page current while the reader is at the top. Polling
  // every workspace tick would race the filters, so it is throttled and only runs when
  // the reader has not asked for older pages yet.
  useEffect(() => {
    if (Date.now() - lastLive.current < 5_000) return;
    lastLive.current = Date.now();
    if (nextCursor) return;
    // The first page is fetched in an effect on mount/live tick by design.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFirst();
  }, [live, nextCursor, loadFirst]);

  function changeScope(next: ActivityScope) {
    setScope(next);
    syncUrl({ scope: next, type: objectType, project: projectId, person: personId });
    void loadFirst({ scope: next, objectType, projectId, personId });
  }

  function changeType(next: ActivityObjectType | "") {
    setObjectType(next);
    syncUrl({ scope, type: next, project: projectId, person: personId });
    void loadFirst({ scope, objectType: next, projectId, personId });
  }

  function changeProject(next: string) {
    setProjectId(next);
    syncUrl({ scope, type: objectType, project: next, person: personId });
    void loadFirst({ scope, objectType, projectId: next, personId });
  }

  function changePerson(next: string) {
    setPersonId(next);
    syncUrl({ scope, type: objectType, project: projectId, person: next });
    void loadFirst({ scope, objectType, projectId, personId: next });
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await loadActivityAction(workspaceId, query(nextCursor));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const known = new Set(items.map((item) => item.id));
      setItems((old) => [...old, ...result.data.items.filter((item) => !known.has(item.id))]);
      setNextCursor(result.data.nextCursor);
      setError(null);
    } catch {
      setError(t("Could not load activity. Retry."));
    } finally {
      setLoadingMore(false);
    }
  }

  function open(item: WorkspaceActivityItem) {
    if (item.objectType === "task") {
      openIssue(item.objectId, typeof item.data.commentId === "string" ? item.data.commentId : undefined);
      return;
    }
    if (item.objectType === "document") {
      openPage(item.objectId, typeof item.data.commentId === "string" ? item.data.commentId : undefined);
    }
  }

  const groups: { key: string; items: WorkspaceActivityItem[] }[] = [];
  for (const item of items) {
    const key = dayKey(item.createdAt);
    const last = groups.at(-1);
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }

  return (
    <div className="flex-1 overflow-y-auto pb-10" data-testid="activity-feed">
      <header className={`${PAGE_HEADER} ${PAGE_INSET}`}>
        <h1 className={PAGE_TITLE}>{t("Activity")}</h1>
      </header>
      <p className={`pt-3 text-small text-muted ${PAGE_INSET}`}>
        {t("Everything that changed in this workspace. Inbox is for notices that need you.")}
      </p>
      <div className={`space-y-4 pt-3 ${PAGE_INSET}`}>
        <div className="flex flex-wrap items-center gap-2" data-testid="activity-filters">
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
            {SCOPES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => changeScope(option.id)}
                aria-pressed={scope === option.id}
                data-testid={`activity-scope-${option.id}`}
                className={`rounded px-2.5 py-1 text-small transition-colors ${
                  scope === option.id ? "bg-elevated font-medium text-text" : "text-muted hover:text-text"
                }`}
              >
                {t(option.label)}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-small text-muted">
            <span className="sr-only">{t("Object type")}</span>
            <select
              value={objectType}
              onChange={(event) => changeType(event.target.value as ActivityObjectType | "")}
              data-testid="activity-filter-type"
              className="rounded-md border border-border bg-bg px-2 py-1 text-small text-text"
            >
              {OBJECT_TYPES.map((option) => (
                <option key={option.id || "all"} value={option.id}>
                  {t(option.label)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-small text-muted">
            <span className="sr-only">{t("Project")}</span>
            <select
              value={projectId}
              onChange={(event) => changeProject(event.target.value)}
              data-testid="activity-filter-project"
              className="max-w-[180px] rounded-md border border-border bg-bg px-2 py-1 text-small text-text"
            >
              <option value="">{t("All projects")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-small text-muted">
            <span className="sr-only">{t("Person")}</span>
            <select
              value={personId}
              onChange={(event) => changePerson(event.target.value)}
              data-testid="activity-filter-person"
              className="max-w-[180px] rounded-md border border-border bg-bg px-2 py-1 text-small text-text"
            >
              <option value="">{t("Anyone")}</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-danger/40 p-3 text-body text-danger">
            {t(error)}{" "}
            <button type="button" onClick={() => void loadFirst()} className="underline">
              {t("Retry")}
            </button>
          </div>
        )}

        {items.length === 0 && !loading && (
          <div className="rounded-lg border border-border p-4 text-body text-faint">
            {t("No activity matches these filters.")}
          </div>
        )}

        {groups.map((group) => (
          <section key={group.key} className="space-y-1">
            <h2 className="px-1 text-small font-medium text-faint">
              {dayLabel(group.items[0].createdAt, locale, t)}
            </h2>
            <div className="divide-y divide-border rounded-lg border border-border bg-bg" data-testid="activity-list">
              {group.items.map((item) => {
                const actor = actorName(
                  { actor: item.actor, agentActor: item.agentActor },
                  t
                );
                const title = item.title || t("Deleted item");
                const Icon =
                  item.objectType === "document"
                    ? FileText
                    : item.objectType === "project"
                      ? FolderKanban
                      : ListChecks;
                return (
                  <div
                    key={item.id}
                    data-testid="activity-row"
                    data-activity-type={item.objectType}
                    data-activity-id={item.id}
                    className="flex items-start gap-2.5 px-3 py-2"
                  >
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-elevated text-faint">
                      {item.actor ? (
                        <AssigneeAvatar displayName={item.actor.displayName} avatar={item.actor.avatar} size={16} />
                      ) : (
                        <Activity size={12} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-baseline gap-1.5 text-body">
                        <span className="font-medium text-text">{actor}</span>
                        <span className="text-muted">{sentence(item, t, locale)}</span>
                        {item.objectType === "project" ? (
                          <Link
                            href={`/${workspaceId}/projects/${item.objectId}`}
                            data-testid="activity-open"
                            className="min-w-0 truncate text-text underline decoration-border underline-offset-2 hover:decoration-text"
                          >
                            {title}
                          </Link>
                        ) : (
                          <a
                            href={(() => {
                              const params = new URLSearchParams();
                              params.set(item.objectType === "document" ? "doc" : "issue", item.objectId);
                              if (typeof item.data.commentId === "string") {
                                params.set("comment", item.data.commentId);
                              }
                              return `?${params.toString()}`;
                            })()}
                            onClick={(event) => {
                              // Same URL the panel would write; open in place instead of
                              // reloading the feed.
                              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                              event.preventDefault();
                              open(item);
                            }}
                            data-testid="activity-open"
                            className="flex min-w-0 items-center gap-1 truncate text-left text-text underline decoration-border underline-offset-2 hover:decoration-text"
                          >
                            <Icon size={12} className="shrink-0 text-faint" />
                            <span className="truncate">{title}</span>
                          </a>
                        )}
                        {item.identifier && <span className="text-caption text-faint">{item.identifier}</span>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-caption text-faint">
                        {item.projectName && <span className="truncate">{item.projectName}</span>}
                        {item.projectName && <span>·</span>}
                        <span suppressHydrationWarning>{timeAgo(item.createdAt, locale)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {nextCursor && (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            data-testid="activity-load-more"
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-small text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
          >
            <ChevronDown size={13} />
            {t("Show older")}
          </button>
        )}
        {loading && <p className="text-small text-faint">{t("Loading…")}</p>}
      </div>
    </div>
  );
}
