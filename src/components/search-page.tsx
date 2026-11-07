"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { PAGE_INSET } from "@/lib/page-chrome";
import { Search, X } from "lucide-react";
import { useT, useLocale } from "@/components/i18n-context";
import { EmptyState } from "@/components/ui/empty-state";
import { useUI } from "@/components/ui-context";
import { SearchHitLabel, SearchKindIcon } from "@/components/search-result";
import { useSearchRecents, type RecentItem } from "@/lib/search-recents";
import {
  GROUP_LABELS,
  GROUP_ORDER,
  kindsForGroup,
  SEARCH_GROUPS,
  type SearchFilters,
  type SearchGroup,
  type SearchSort,
} from "@/lib/search-query";
import { STATUS_META, STATUS_ORDER, type Status } from "@/lib/constants";
import { timeAgo } from "@/lib/format";
import type { SearchHit, SearchResult } from "@/lib/search";

export type SearchProjectOption = { id: string; name: string; key: string };
export type SearchMemberOption = { id: string; displayName: string; username: string };

const PAGE_SIZE = 20;
const DATE_PRESETS = ["1d", "7d", "30d", "90d"] as const;

function presetDate(preset: string): string | undefined {
  const days = preset === "1d" ? 1 : preset === "7d" ? 7 : preset === "30d" ? 30 : preset === "90d" ? 90 : 0;
  if (!days) return undefined;
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function presetLabel(t: ReturnType<typeof useT>, preset: string): string {
  if (preset === "1d") return t("Past 24 hours");
  if (preset === "7d") return t("Past 7 days");
  if (preset === "30d") return t("Past 30 days");
  return t("Past 90 days");
}

export type SearchInitial = {
  query: string;
  kind: SearchGroup;
  sort: SearchSort;
  project: string;
  assignee: string;
  status: Status | "";
  created: string;
  updated: string;
  page: number;
};

export function SearchPageView({
  workspaceId,
  projects,
  members,
  initial,
}: {
  workspaceId: string;
  projects: SearchProjectOption[];
  members: SearchMemberOption[];
  initial: SearchInitial;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { scope, openIssue, openPage } = useUI();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState(initial.query);
  const [kind, setKind] = useState<SearchGroup>(initial.kind);
  const [sort, setSort] = useState<SearchSort>(initial.sort);
  const [project, setProject] = useState(initial.project);
  const [assignee, setAssignee] = useState(initial.assignee);
  const [status, setStatus] = useState<Status | "">(initial.status);
  const [created, setCreated] = useState(initial.created);
  const [updated, setUpdated] = useState(initial.updated);
  const [page, setPage] = useState(initial.page);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { searches, items, rememberSearch, rememberItem, clearSearches, clearItems } =
    useSearchRecents(scope);

  // Keep the URL shareable without adding history entries for every keystroke.
  useEffect(() => {
    const url = new URL(window.location.href);
    const set = (key: string, value: string) => {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    };
    set("q", query.trim());
    set("kind", kind === "all" ? "" : kind);
    set("sort", sort === "relevance" ? "" : sort);
    set("project", project);
    set("assignee", assignee);
    set("status", status);
    set("created", created);
    set("updated", updated);
    set("page", page > 1 ? String(page) : "");
    window.history.replaceState(null, "", url);
  }, [query, kind, sort, project, assignee, status, created, updated, page]);

  const filters = useMemo<SearchFilters>(
    () => ({
      projectId: project || undefined,
      assignee: assignee || undefined,
      status: status || undefined,
      createdFrom: presetDate(created),
      updatedFrom: presetDate(updated),
    }),
    [project, assignee, status, created, updated]
  );

  useEffect(() => {
    const text = query.trim();
    if (!text) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      const search = new URLSearchParams();
      search.set("q", text);
      if (kind !== "all") search.set("kind", kind);
      if (sort !== "relevance") search.set("sort", sort);
      if (filters.projectId) search.set("project", filters.projectId);
      if (filters.assignee) search.set("assignee", filters.assignee);
      if (filters.status) search.set("status", filters.status);
      if (filters.createdFrom) search.set("createdFrom", filters.createdFrom);
      if (filters.updatedFrom) search.set("updatedFrom", filters.updatedFrom);
      search.set("limit", String(PAGE_SIZE));
      search.set("offset", String((page - 1) * PAGE_SIZE));
      search.set("counts", "1");
      try {
        const response = await fetch(
          `/api/internal/${workspaceId}/search?${search.toString()}`,
          { signal: controller.signal }
        );
        const data: unknown = await response.json();
        if (!response.ok) {
          const message =
            data && typeof data === "object" && "error" in data
              ? String((data as { error: unknown }).error)
              : t("Search failed. Retry.");
          throw new Error(message);
        }
        if (!data || typeof data !== "object" || !Array.isArray((data as SearchResult).hits)) {
          throw new Error(t("Unexpected response. Retry."));
        }
        setResult(data as SearchResult);
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : t("Search failed. Retry."));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 150);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [workspaceId, query, kind, sort, filters, page, attempt, t]);

  const commit = useCallback(() => {
    rememberSearch(query, kind);
  }, [rememberSearch, query, kind]);

  const changeQuery = (value: string) => {
    setQuery(value);
    setPage(1);
  };
  const change = (apply: () => void) => {
    apply();
    setPage(1);
  };

  const openHit = useCallback(
    (hit: SearchHit | RecentItem) => {
      rememberItem(hit as SearchHit);
      rememberSearch(query, kind);
      if (hit.target === "issue" || hit.kind === "task_comment") {
        openIssue(hit.openId, hit.kind === "task_comment" ? hit.id : undefined);
        return;
      }
      if (hit.target === "page") {
        openPage(hit.openId, hit.kind === "doc_comment" ? hit.id : undefined);
        return;
      }
      if (hit.href) {
        router.push(hit.href);
        return;
      }
      if (hit.target === "thread") router.push(`/${workspaceId}/agent?thread=${hit.openId}`);
    },
    [kind, openIssue, openPage, query, rememberItem, rememberSearch, router, workspaceId]
  );

  const groupCount = (group: SearchGroup): number =>
    kindsForGroup(group).reduce((sum, entry) => sum + (result?.counts[entry] ?? 0), 0);
  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const grouped = useMemo(() => {
    if (!result) return [];
    return GROUP_ORDER.map((group) => ({
      group,
      hits: result.hits.filter((hit) => kindsForGroup(group).includes(hit.kind)),
    })).filter((entry) => entry.hits.length > 0);
  }, [result]);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const rows = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("[data-search-row]")
    );
    if (!rows.length) return;
    const active = document.activeElement as HTMLElement | null;
    const index = active ? rows.indexOf(active) : -1;
    if (event.key === "ArrowDown" && (index < 0 || active === inputRef.current)) {
      event.preventDefault();
      rows[0].focus();
      return;
    }
    if (index < 0) return;
    event.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))].focus();
  };

  const hasFilters = Boolean(project || assignee || status || created || updated);
  const clearFilters = () => {
    setProject("");
    setAssignee("");
    setStatus("");
    setCreated("");
    setUpdated("");
    setPage(1);
  };

  return (
    <div
      data-testid="search-page"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
      onKeyDown={onSearchKeyDown}
    >
      <div className={`w-full py-3 ${PAGE_INSET}`}>
        <h1 className="sr-only">{t("Search")}</h1>
        <div className="relative">
          <Search
            size={16}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            ref={inputRef}
            data-testid="search-input"
            type="search"
            autoFocus
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
              if (event.key === "Escape") {
                event.currentTarget.blur();
              }
            }}
            onBlur={() => {
              if (query.trim()) commit();
            }}
            aria-label={t("Search everything")}
            placeholder={t("Search tasks, documents, people, labels, files and rules…")}
            className="w-full rounded-md border border-border bg-bg py-2 pl-9 pr-9 text-body outline-none transition-colors focus:border-border-strong"
          />
          {query && (
            <button
              type="button"
              data-testid="search-clear"
              aria-label={t("Clear search")}
              onClick={() => {
                changeQuery("");
                inputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:bg-elevated hover:text-text"
            >
              <X size={14} />
            </button>
          )}
          {loading && result && (
            <div
              data-testid="search-progress"
              role="status"
              aria-label={t("Searching…")}
              className="absolute inset-x-3 -bottom-px h-0.5 overflow-hidden rounded bg-elevated"
            >
              <div className="h-full w-1/3 animate-pulse rounded bg-accent/40" />
            </div>
          )}
        </div>

        <div
          data-testid="search-tabs"
          role="tablist"
          aria-label={t("Result kinds")}
          className="mt-3 flex flex-wrap gap-x-1 border-b border-border pb-0"
        >
          {SEARCH_GROUPS.map((group) => {
            const count = result ? groupCount(group) : null;
            return (
              <button
                key={group}
                type="button"
                role="tab"
                aria-selected={kind === group}
                data-testid={`search-tab-${group}`}
                onClick={() => change(() => setKind(group))}
                className={`shrink-0 border-b-2 px-2.5 pb-2 pt-1 text-small transition-colors ${
                  kind === group
                    ? "border-accent font-medium text-text"
                    : "border-transparent text-muted hover:text-text"
                }`}
              >
                {t(GROUP_LABELS[group])}
                {count !== null && (
                  <span className="ml-1 tabular-nums text-caption text-faint">{count}</span>
                )}
              </button>
            );
          })}
        </div>

        <div
          data-testid="search-filters"
          className="flex flex-wrap items-center gap-1.5 border-b border-border py-2"
        >
          <select
            data-testid="search-filter-project"
            aria-label={t("Project")}
            value={project}
            onChange={(event) => change(() => setProject(event.target.value))}
            className="max-w-[180px] rounded border border-border bg-bg px-2 py-1 text-small text-muted"
          >
            <option value="">{t("All projects")}</option>
            {projects.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          <select
            data-testid="search-filter-assignee"
            aria-label={t("Assignee")}
            value={assignee}
            onChange={(event) => change(() => setAssignee(event.target.value))}
            className="max-w-[180px] rounded border border-border bg-bg px-2 py-1 text-small text-muted"
          >
            <option value="">{t("Anyone")}</option>
            <option value="me">{t("Assigned to me")}</option>
            <option value="none">{t("Unassigned")}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
          <select
            data-testid="search-filter-status"
            aria-label={t("Status")}
            value={status}
            onChange={(event) =>
              change(() => setStatus(event.target.value ? (event.target.value as Status) : ""))
            }
            className="rounded border border-border bg-bg px-2 py-1 text-small text-muted"
          >
            <option value="">{t("Any status")}</option>
            {STATUS_ORDER.map((entry) => (
              <option key={entry} value={entry}>
                {t(STATUS_META[entry].label)}
              </option>
            ))}
          </select>
          <select
            data-testid="search-filter-created"
            aria-label={t("Created")}
            value={created}
            onChange={(event) => change(() => setCreated(event.target.value))}
            className="rounded border border-border bg-bg px-2 py-1 text-small text-muted"
          >
            <option value="">{t("Created anytime")}</option>
            {DATE_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {presetLabel(t, preset)}
              </option>
            ))}
          </select>
          <select
            data-testid="search-filter-updated"
            aria-label={t("Updated")}
            value={updated}
            onChange={(event) => change(() => setUpdated(event.target.value))}
            className="rounded border border-border bg-bg px-2 py-1 text-small text-muted"
          >
            <option value="">{t("Updated anytime")}</option>
            {DATE_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {presetLabel(t, preset)}
              </option>
            ))}
          </select>
          <select
            data-testid="search-sort"
            aria-label={t("Sort")}
            value={sort}
            onChange={(event) =>
              change(() => setSort(event.target.value as SearchSort))
            }
            className="rounded border border-border bg-bg px-2 py-1 text-small text-muted"
          >
            <option value="relevance">{t("Best match")}</option>
            <option value="updated">{t("Recently updated")}</option>
            <option value="created">{t("Recently created")}</option>
          </select>
          {hasFilters && (
            <button
              type="button"
              data-testid="search-filters-clear"
              onClick={clearFilters}
              className="rounded px-1.5 py-1 text-small text-muted underline-offset-2 hover:text-text hover:underline"
            >
              {t("Clear filters")}
            </button>
          )}
          {(assignee || status) && (
            <span className="text-caption text-faint">{t("Assignee and status apply to tasks.")}</span>
          )}
        </div>

        <div className="mt-3">
          {error && query.trim() && (
            <div
              data-testid="search-error"
              role="alert"
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-body text-text"
            >
              <span>{t(error)}</span>
              <button
                type="button"
                data-testid="search-retry"
                onClick={() => setAttempt((value) => value + 1)}
                className="shrink-0 rounded border border-border px-2 py-1 text-small hover:bg-elevated"
              >
                {t("Retry")}
              </button>
            </div>
          )}

          {!query.trim() ? (
            <SearchIdle
              searches={searches}
              items={items}
              onSearch={(entry) => {
                changeQuery(entry.text);
                change(() => setKind(entry.group));
              }}
              onOpen={openHit}
              onClearSearches={clearSearches}
              onClearItems={clearItems}
              onSuggest={(nextKind, nextAssignee) => {
                change(() => setKind(nextKind));
                if (nextAssignee) change(() => setAssignee(nextAssignee));
              }}
            />
          ) : !result && loading ? (
            <SearchSkeleton />
          ) : result && result.hits.length === 0 && !loading ? (
            <div data-testid="search-empty">
              <EmptyState
                title={t("No results for “{query}”", { query: query.trim() })}
                hint={hasFilters
                  ? t("Clear filters or try a different term.")
                  : t("Try a shorter term, or check the spelling.")}
              />
              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-3 rounded border border-border px-2.5 py-1 text-small hover:bg-elevated"
                >
                  {t("Clear filters")}
                </button>
              )}
            </div>
          ) : result && result.hits.length > 0 ? (
            <div data-testid="search-results" aria-busy={loading} className={loading ? "opacity-70" : ""}>
              <div className="mb-2 flex items-center justify-between gap-2 text-small text-faint">
                <span data-testid="search-total" className="tabular-nums">
                  {t(total === 1 ? "{count} result" : "{count} results", { count: total })}
                </span>
                <span className="tabular-nums">{t("Page {page} of {pages}", { page, pages })}</span>
              </div>
              {grouped.map(({ group, hits }) => {
                const count = groupCount(group);
                return (
                  <section key={group} data-testid={`search-group-${group}`} className="mb-3">
                    <h2 className="mb-1 flex items-baseline gap-2 px-1 text-small font-medium text-muted">
                      {t(GROUP_LABELS[group])}
                      {count > hits.length && (
                        <span className="tabular-nums text-caption text-faint">
                          {t("{count} total", { count })}
                        </span>
                      )}
                    </h2>
                    <div className="space-y-0.5">
                      {hits.map((hit) => (
                        <button
                          key={`${hit.kind}:${hit.id}`}
                          type="button"
                          data-testid={`search-result-${hit.kind}-${hit.id}`}
                          data-search-row
                          data-search-kind={hit.kind}
                          onClick={() => openHit(hit)}
                          className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-body transition-colors hover:bg-elevated/60 focus-visible:bg-elevated/60"
                        >
                          <SearchHitLabel
                            hit={hit}
                            query={query}
                            showKind={false}
                            trailing={
                              <span
                                suppressHydrationWarning
                                className="shrink-0 text-caption text-faint"
                              >
                                {timeAgo(hit.updatedAt, locale)}
                              </span>
                            }
                          />
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
              <div
                data-testid="search-pagination"
                className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-small"
              >
                <span className="tabular-nums text-faint">{t("Page {page} of {pages}", { page, pages })}</span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    data-testid="search-prev"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    className="rounded border border-border px-2 py-1 disabled:opacity-40"
                  >
                    {t("Previous")}
                  </button>
                  <button
                    type="button"
                    data-testid="search-next"
                    disabled={page >= pages || loading}
                    onClick={() => setPage((value) => Math.min(pages, value + 1))}
                    className="rounded border border-border px-2 py-1 disabled:opacity-40"
                  >
                    {t("Next")}
                  </button>
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SearchIdle({
  searches,
  items,
  onSearch,
  onOpen,
  onClearSearches,
  onClearItems,
  onSuggest,
}: {
  searches: { text: string; group: SearchGroup; at: string }[];
  items: RecentItem[];
  onSearch: (entry: { text: string; group: SearchGroup; at: string }) => void;
  onOpen: (hit: RecentItem) => void;
  onClearSearches: () => void;
  onClearItems: () => void;
  onSuggest: (group: SearchGroup, assignee?: "me") => void;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <div data-testid="search-idle" className="mx-auto w-full max-w-[600px] space-y-6 py-6">
      <section data-testid="search-recent-searches">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-small font-medium text-muted">{t("Recent searches")}</h2>
          {searches.length > 0 && (
            <button
              type="button"
              onClick={onClearSearches}
              className="text-caption text-faint hover:text-text"
            >
              {t("Clear")}
            </button>
          )}
        </div>
        {searches.length === 0 ? (
          <p className="text-small text-faint">{t("No recent searches yet.")}</p>
        ) : (
          <div className="space-y-0.5">
            {searches.map((entry, index) => (
              <button
                key={`${entry.text}:${entry.group}:${entry.at}`}
                type="button"
                data-testid={`search-recent-query-${index}`}
                onClick={() => onSearch(entry)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-body hover:bg-elevated/60"
              >
                <Search size={13} className="shrink-0 text-faint" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{entry.text}</span>
                {entry.group !== "all" && (
                  <span className="shrink-0 text-caption text-faint">
                    {t(GROUP_LABELS[entry.group])}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </section>
      <section data-testid="search-recent-items">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-small font-medium text-muted">{t("Recent items")}</h2>
          {items.length > 0 && (
            <button
              type="button"
              onClick={onClearItems}
              className="text-caption text-faint hover:text-text"
            >
              {t("Clear")}
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-small text-faint">
            {t("Open a result and it will show up here.")}
          </p>
        ) : (
          <div className="space-y-0.5">
            {items.map((item, index) => (
              <button
                key={`${item.kind}:${item.id}`}
                type="button"
                data-testid={`search-recent-item-${index}`}
                onClick={() => onOpen(item)}
                className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left text-body hover:bg-elevated/60"
              >
                <SearchKindIcon kind={item.kind} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    {item.ref && (
                      <span className="shrink-0 font-mono text-small text-faint">{item.ref}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{item.title || t("Untitled")}</span>
                  </span>
                  {item.context && (
                    <span className="block truncate text-caption text-faint">{item.context}</span>
                  )}
                </span>
                <span suppressHydrationWarning className="shrink-0 text-caption text-faint">
                  {timeAgo(item.at, locale)}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
      <section data-testid="search-suggestions" className="@2xl:col-span-2">
        <h2 className="mb-2 text-small font-medium text-muted">{t("Suggestions")}</h2>
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: "my-tasks", label: t("Tasks assigned to me"), group: "task" as SearchGroup, assignee: "me" as const },
            { id: "documents", label: t("Browse documents"), group: "doc" as SearchGroup },
            { id: "people", label: t("Find a person"), group: "person" as SearchGroup },
          ].map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              data-testid={`search-suggestion-${suggestion.id}`}
              onClick={() => onSuggest(suggestion.group, suggestion.assignee)}
              className="rounded-full border border-border px-2.5 py-1 text-small text-muted hover:bg-elevated hover:text-text"
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      </section>
      <p className="text-small text-faint @2xl:col-span-2">
        {t("Type a title, name, label or file. Use filters to narrow tasks and documents.")}
      </p>
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div data-testid="search-loading" aria-busy="true" className="space-y-1.5 py-4">
      {[0, 1, 2, 3, 4].map((index) => (
        <div
          key={index}
          className="animate-pulse rounded-md border border-border/60 px-3 py-2.5"
        >
          <div className="h-3 w-1/3 rounded bg-elevated" />
          <div className="mt-2 h-2.5 w-2/3 rounded bg-elevated" />
        </div>
      ))}
    </div>
  );
}
