"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { useUI } from "@/components/ui-context";
import { useContentColumnOffset } from "@/components/ui/modal";
import { Search } from "lucide-react";
import { StatusIcon, STATUS_META } from "@/components/icons";
import { updateIssueAction } from "@/app/actions";
import { STATUS_ORDER } from "@/lib/constants";
import type { SearchHit } from "@/lib/search";
import { useT } from "@/components/i18n-context";
import { SearchHitLabel, SearchKindIcon } from "@/components/search-result";
import { useSearchRecents, type RecentItem } from "@/lib/search-recents";
import {
  GROUP_LABELS,
  GROUP_ORDER,
  PREFIXES,
  KIND_GROUP,
  kindsForGroup,
  parseSearchInput,
  removeSearchToken,
  type SearchGroup,
} from "@/lib/search-query";

const PER_KIND = 4;

function prefixForGroup(group: SearchGroup): string | null {
  return PREFIXES.find((entry) => entry.group === group)?.key ?? null;
}

export function CommandPalette({ workspaceId }: { workspaceId: string }) {
  const { paletteOpen } = useUI();
  if (!paletteOpen) return null;
  // Mounted fresh on every open, so the query and any old results start clean.
  return <PaletteInner workspaceId={workspaceId} />;
}

function PaletteInner({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const paletteOffset = useContentColumnOffset(true);
  const { setPaletteOpen, openIssue, openPage, focused, setComposerOpen, scope } = useUI();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [results, setResults] = useState<SearchHit[]>([]);
  const { searches, items, rememberSearch, rememberItem, clearSearches, clearItems } =
    useSearchRecents(scope);

  const parsed = parseSearchInput(query);
  const content = parsed.text;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);

  useEffect(() => {
    if (!content) return;
    const controller = new AbortController();
    let current = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      params.set("q", content);
      if (parsed.group !== "all") params.set("kind", parsed.group);
      if (parsed.filters.assignee) params.set("assignee", parsed.filters.assignee);
      if (parsed.filters.status) params.set("status", parsed.filters.status);
      params.set("per", String(PER_KIND));
      params.set("counts", "0");
      try {
        const response = await fetch(
          `/api/internal/${workspaceId}/search?${params.toString()}`,
          { signal: controller.signal }
        );
        const data: unknown = await response.json();
        if (!response.ok) throw new Error(t("Search failed. Retry."));
        if (!data || typeof data !== "object" || !Array.isArray((data as { hits: unknown }).hits)) {
          throw new Error(t("Unexpected response. Retry."));
        }
        if (current) setResults((data as { hits: SearchHit[] }).hits);
      } catch (err) {
        if (current) {
          setError(err instanceof Error ? err.message : t("Search failed. Retry."));
        }
      } finally {
        if (current) setLoading(false);
      }
    }, 150);
    return () => {
      current = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [content, parsed.group, parsed.filters.assignee, parsed.filters.status, workspaceId, attempt, t]);

  const close = () => setPaletteOpen(false);

  const openHit = (hit: SearchHit | RecentItem) => {
    rememberItem(hit as SearchHit);
    if (content) rememberSearch(content, parsed.group);
    if (hit.target === "issue" && hit.kind !== "task_comment") openIssue(hit.openId);
    else if (hit.target === "issue") openIssue(hit.openId, hit.id);
    else if (hit.target === "page" && hit.kind !== "doc_comment") openPage(hit.openId);
    else if (hit.target === "page") openPage(hit.openId, hit.id);
    else if (hit.href) router.push(hit.href);
    else if (hit.target === "thread") router.push(`/${workspaceId}/agent?thread=${hit.openId}`);
    close();
  };

  const searchAll = () => {
    const params = new URLSearchParams();
    if (content) params.set("q", content);
    if (parsed.group !== "all") params.set("kind", parsed.group);
    if (parsed.filters.assignee) params.set("assignee", parsed.filters.assignee);
    if (parsed.filters.status) params.set("status", parsed.filters.status);
    rememberSearch(content, parsed.group);
    close();
    router.push(`/${workspaceId}/search${params.toString() ? `?${params.toString()}` : ""}`);
  };

  const insertPrefix = (prefix: string) => {
    const next = query.match(/^[ipudaf](?::\s*|\s+)/i)
      ? query.replace(/^[ipudaf](?::\s*|\s+)/i, `${prefix} `)
      : `${prefix} ${query}`;
    setQuery(next);
    inputRef.current?.focus();
  };

  const removeScope = () => {
    setQuery(query.replace(/^[ipudaf](?::\s*|\s+)/i, ""));
    inputRef.current?.focus();
  };

  const activeFilters: string[] = [];
  for (const token of query.split(/\s+/)) {
    const value = /^@([a-z_]+)$/i.exec(token)?.[1].toLowerCase();
    if (!value) continue;
    if (value === "me" || value === "none" || value === "unassigned" || STATUS_ORDER.includes(value as never)) {
      activeFilters.push(token);
    }
  }

  const ordered = GROUP_ORDER.flatMap((group) =>
    results.filter((hit) => kindsForGroup(group).includes(hit.kind))
  );

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={close} />
      <div
        className="fixed left-1/2 top-[12vh] z-50 w-[620px] max-w-[94vw] -translate-x-1/2"
        style={{ left: `calc(50% + ${paletteOffset}px)` }}
      >
        <Command
          loop
          shouldFilter={false}
          data-testid="command-palette"
          className="cmdk-palette overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl shadow-black/15"
        >
          <div className="relative border-b border-border">
            <Search
              size={15}
              aria-hidden
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
            />
            <Command.Input
              ref={inputRef}
              data-testid="palette-input"
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder={t("Search or jump to…")}
              className="!pl-10 outline-none"
              // The global :focus-visible ring is unlayered, so a utility class cannot remove
              // it; the palette already marks focus by opening itself, so the input stays flat.
              style={{ outline: "none" }}
            />
            {(parsed.prefix || activeFilters.length > 0) && (
              <div
                data-testid="palette-active-filters"
                className="flex flex-wrap items-center gap-1 border-t border-border px-3 py-1.5"
              >
                {parsed.prefix && (
                  <button
                    type="button"
                    data-testid="palette-scope"
                    onClick={removeScope}
                    className="rounded-lg bg-elevated px-2 py-0.5 text-caption text-text"
                  >
                    {t(GROUP_LABELS[parsed.group])} ×
                  </button>
                )}
                {activeFilters.map((token) => (
                  <button
                    key={token}
                    type="button"
                    data-testid={`palette-filter-${token.slice(1).toLowerCase()}`}
                    onClick={() => {
                      setQuery(removeSearchToken(query, token));
                      inputRef.current?.focus();
                    }}
                    className="rounded-lg bg-elevated px-2 py-0.5 font-mono text-caption text-text"
                  >
                    {token} ×
                  </button>
                ))}
                {loading && (
                  <span data-testid="palette-loading" className="ml-auto text-caption text-faint">
                    {t("Searching…")}
                  </span>
                )}
              </div>
            )}
          </div>
          <Command.List className="max-h-[420px] overflow-y-auto p-1 pb-2">
            {error && content ? (
              <Command.Item
                value="search error retry"
                data-testid="palette-error"
                onSelect={() => setAttempt((value) => value + 1)}
                className="!text-danger"
              >
                {t(error)} · {t("Retry")}
              </Command.Item>
            ) : null}

            {!content && !error ? (
              <>
                {searches.length > 0 && (
                  <Command.Group heading={t("Recent searches")}>
                    {searches.map((entry, index) => {
                      const prefix = prefixForGroup(entry.group);
                      const raw = prefix ? `${prefix} ${entry.text}` : entry.text;
                      return (
                        <Command.Item
                          key={`${entry.text}:${entry.group}:${entry.at}`}
                          value={`recent search ${entry.text} ${entry.group}`}
                          keywords={[entry.text]}
                          data-testid={`palette-recent-search-${index}`}
                          onSelect={() => setQuery(raw)}
                        >
                          <Search size={13} className="shrink-0 text-faint" />
                          <span className="min-w-0 flex-1 truncate">{entry.text}</span>
                          <span className="shrink-0 text-caption text-faint">
                            {t(GROUP_LABELS[entry.group])}
                          </span>
                        </Command.Item>
                      );
                    })}
                    <Command.Item
                      value="clear recent searches"
                      data-testid="palette-clear-searches"
                      onSelect={clearSearches}
                      className="!text-faint"
                    >
                      {t("Clear recent searches")}
                    </Command.Item>
                  </Command.Group>
                )}
                {items.length > 0 && (
                  <Command.Group heading={t("Recent items")}>
                    {items.map((item, index) => (
                      <Command.Item
                        key={`${item.kind}:${item.id}`}
                        value={`recent item ${item.kind} ${item.id}`}
                        keywords={[item.title]}
                        data-testid={`palette-recent-item-${index}`}
                        onSelect={() => openHit(item)}
                      >
                        <SearchKindIcon kind={item.kind} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            {item.ref && (
                              <span className="shrink-0 font-mono text-small text-faint">
                                {item.ref}
                              </span>
                            )}
                            <span className="min-w-0 flex-1 truncate">
                              {item.title || t("Untitled")}
                            </span>
                          </span>
                          {item.context && (
                            <span className="block truncate text-small text-faint">
                              {item.context}
                            </span>
                          )}
                        </span>
                      </Command.Item>
                    ))}
                    <Command.Item
                      value="clear recent items"
                      data-testid="palette-clear-items"
                      onSelect={clearItems}
                      className="!text-faint"
                    >
                      {t("Clear recent items")}
                    </Command.Item>
                  </Command.Group>
                )}
                <Command.Group heading={t("Suggestions")}>
                  <Command.Item
                    value="suggestion assigned to me"
                    data-testid="palette-suggestion-me"
                    onSelect={() => {
                      setQuery(query.trim() ? `${query.trim()} @me` : "@me");
                    }}
                  >
                    <Search size={13} className="shrink-0 text-faint" />
                    {t("Tasks assigned to me")}
                    <kbd className="ml-auto rounded border border-border bg-elevated px-1 font-mono text-caption text-faint">
                      @me
                    </kbd>
                  </Command.Item>
                  <Command.Item
                    value="suggestion documents"
                    data-testid="palette-suggestion-d"
                    onSelect={() => insertPrefix("d")}
                  >
                    <Search size={13} className="shrink-0 text-faint" />
                    {t("Browse documents")}
                    <kbd className="ml-auto rounded border border-border bg-elevated px-1 font-mono text-caption text-faint">
                      d
                    </kbd>
                  </Command.Item>
                  <Command.Item
                    value="suggestion people"
                    data-testid="palette-suggestion-u"
                    onSelect={() => insertPrefix("u")}
                  >
                    <Search size={13} className="shrink-0 text-faint" />
                    {t("Find a person")}
                    <kbd className="ml-auto rounded border border-border bg-elevated px-1 font-mono text-caption text-faint">
                      u
                    </kbd>
                  </Command.Item>
                </Command.Group>
              </>
            ) : null}

            {content && !error ? (
              <>
                {loading && results.length === 0 && (
                  <div data-testid="palette-results-loading" className="px-3 py-4 text-center text-body text-faint">
                    {t("Searching…")}
                  </div>
                )}
                {!loading && results.length === 0 && (
                  <Command.Item
                    value="no results open full search"
                    data-testid="palette-empty"
                    onSelect={searchAll}
                  >
                    <Search size={13} className="shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate">
                      {t("No results for “{query}”", { query: content })}
                    </span>
                    <span className="shrink-0 text-caption text-faint">
                      {t("Search all results")}
                    </span>
                  </Command.Item>
                )}
                {ordered.length > 0 && (
                  <Command.Group heading={t("Search results")}>
                    {ordered.map((hit) => (
                      <Command.Item
                        key={`${hit.kind}:${hit.id}`}
                        value={`${hit.kind} ${hit.id}`}
                        keywords={[content]}
                        data-testid={`palette-result-${hit.kind}-${hit.id}`}
                        onSelect={() => openHit(hit)}
                      >
                        <SearchHitLabel
                          hit={hit}
                          query={content}
                          showKind={false}
                          trailing={
                            <span className="shrink-0 text-caption text-faint">
                              {t(GROUP_LABELS[KIND_GROUP[hit.kind]])}
                            </span>
                          }
                        />
                      </Command.Item>
                    ))}
                    <Command.Item
                      value="search all results"
                      data-testid="palette-see-all"
                      onSelect={searchAll}
                    >
                      <Search size={13} className="shrink-0 text-faint" />
                      <span className="min-w-0 flex-1 truncate">
                        {t("Search all results for “{query}”", { query: content })}
                      </span>
                    </Command.Item>
                  </Command.Group>
                )}
              </>
            ) : null}

            {content && (
            <>
            <Command.Group heading={t("Commands")}>
              <Command.Item
                value="new task create"
                data-testid="palette-command-new-task"
                onSelect={() => {
                  setComposerOpen(true);
                  close();
                }}
              >
                <span className="min-w-0 flex-1 truncate">{t("New task")}</span>
                <kbd className="rounded border border-border bg-elevated px-1 font-mono text-caption text-faint">C</kbd>
              </Command.Item>
              {focused &&
                STATUS_ORDER.map((status) => (
                  <Command.Item
                    key={status}
                    value={`move ${focused.ref} ${t(STATUS_META[status].label)}`}
                    data-testid={`palette-command-move-${status}`}
                    onSelect={() => {
                      void updateIssueAction(workspaceId, focused.id, { status }).then((result) => {
                        if (result.ok) {
                          close();
                          router.refresh();
                        } else setError(result.error);
                      });
                    }}
                  >
                    <StatusIcon status={status} size={13} />
                    {t("Move {ref} to {status}", {
                      ref: focused.ref,
                      status: t(STATUS_META[status].label),
                    })}
                  </Command.Item>
                ))}
              {focused && (
                <Command.Item
                  value="copy identifier"
                  data-testid="palette-command-copy-identifier"
                  onSelect={() => {
                    void navigator.clipboard.writeText(focused.ref);
                    close();
                  }}
                >
                  {t("Copy identifier ({ref})", { ref: focused.ref })}
                </Command.Item>
              )}
            </Command.Group>

            <Command.Group heading={t("Navigation")}>
              <Command.Item
                value="all issues"
                data-testid="palette-command-all-tasks"
                onSelect={() => {
                  router.push(`/${workspaceId}`);
                  close();
                }}
              >
                {t("Go to All Tasks")}
              </Command.Item>
              <Command.Item
                value="my issues"
                data-testid="palette-command-my-tasks"
                onSelect={() => {
                  router.push(`/${workspaceId}?assignee=me`);
                  close();
                }}
              >
                {t("Go to My Tasks")}
              </Command.Item>
              <Command.Item
                value="notifications inbox"
                data-testid="palette-command-inbox"
                onSelect={() => {
                  router.push(`/${workspaceId}/notifications`);
                  close();
                }}
              >
                {t("Go to Inbox")}
              </Command.Item>
              <Command.Item
                value="labels"
                data-testid="palette-command-labels"
                onSelect={() => {
                  router.push(`/${workspaceId}/settings#labels`);
                  close();
                }}
              >
                {t("Go to Labels")}
              </Command.Item>
              <Command.Item
                value="settings api keys agent members projects"
                data-testid="palette-command-settings"
                onSelect={() => {
                  router.push(`/${workspaceId}/settings`);
                  close();
                }}
              >
                {t("Go to Settings")}
              </Command.Item>
            </Command.Group>
            </>
            )}
          </Command.List>
          <div className="flex flex-wrap items-center gap-3 border-t border-border px-3 py-2 text-caption text-faint">
            <span>
              <kbd className="rounded border border-border bg-elevated px-1 font-mono">↑↓</kbd>{" "}
              {t("navigate")}
            </span>
            <span>
              <kbd className="rounded border border-border bg-elevated px-1 font-mono">↵</kbd>{" "}
              {t("select")}
            </span>
            <span>
              <kbd className="rounded border border-border bg-elevated px-1 font-mono">esc</kbd>{" "}
              {t("close")}
            </span>
          </div>
        </Command>
      </div>
    </>
  );
}
