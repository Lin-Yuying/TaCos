"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { useUI } from "@/components/ui-context";
import { FileText, MessageSquare, SquareCheck } from "lucide-react";
import { StatusIcon, STATUS_META } from "@/components/icons";
import { updateIssueAction } from "@/app/actions";
import { STATUS_ORDER } from "@/lib/constants";
import type { SearchHit } from "@/lib/search";
import { timeAgo } from "@/lib/format";
import { useLocale, useT } from "@/components/i18n-context";

const SEARCH_GROUPS: { heading: string; kinds: SearchHit["kind"][]; Icon: typeof FileText }[] = [
  { heading: "Documents", kinds: ["doc"], Icon: FileText },
  { heading: "Issues", kinds: ["task"], Icon: SquareCheck },
  { heading: "Comments", kinds: ["task_comment", "doc_comment"], Icon: MessageSquare },
];

export function CommandPalette({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const locale = useLocale();
  const { paletteOpen, setPaletteOpen, openIssue, openPage, focused, setComposerOpen } = useUI();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [results, setResults] = useState<SearchHit[]>([]);

  useEffect(() => {
    if (!paletteOpen) return;
    setQuery("");
    setResults([]);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);

  useEffect(() => {
    if (!paletteOpen) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    let current = true;
    setLoading(true); setError(null);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/internal/${workspaceId}/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        if (!res.ok) throw new Error(res.status === 401 ? "Not signed in" : "Could not load. Retry.");
        const data: unknown = await res.json();
        if (!Array.isArray(data)) throw new Error("Unexpected response. Retry.");
        if (current) setResults(data as SearchHit[]);
      } catch (err) { if (current) { setResults([]); setError(err instanceof Error ? err.message : "Something went wrong"); } }
      finally { if (current) setLoading(false); }
    }, 150);
    return () => { current = false; controller.abort(); clearTimeout(timer); };
  }, [query, paletteOpen, workspaceId, attempt]);

  if (!paletteOpen) return null;

  const close = () => setPaletteOpen(false);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={close} />
      <div className="fixed inset-x-0 top-[14vh] z-50 mx-auto w-[560px] max-w-[92vw]">
        <Command
          loop
          className="cmdk-palette overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl shadow-black/15"
        >
          <div className="border-b border-border">
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder={t("Search documents, tasks and comments, or run a command…")}
            />
          </div>
          <Command.List className="max-h-[380px] overflow-y-auto p-1 pb-2">
            <Command.Empty>
              <div className="px-3 py-6 text-center text-body text-faint">
                {loading ? t("Loading…") : error ? <button onClick={() => setAttempt((n) => n + 1)}>{t(error)} · {t("Retry")}</button> : t("No results for “{query}”", {query})}
              </div>
            </Command.Empty>

            {query.trim() &&
              SEARCH_GROUPS.map(({ heading, kinds, Icon }) => {
                const hits = results.filter((hit) => kinds.includes(hit.kind));
                if (!hits.length) return null;
                return (
                  <Command.Group key={heading} heading={t(heading)}>
                    {hits.map((hit) => (
                      <Command.Item
                        key={hit.id}
                        data-search-hit={hit.kind}
                        value={`${hit.kind} ${hit.id}`}
                        // The server already matched; the palette's own filter only sees this text.
                        keywords={[query]}
                        onSelect={() => {
                          if (hit.kind === "doc" || hit.kind === "doc_comment") openPage(hit.openId,hit.kind==="doc_comment"?hit.id:undefined);
                          else openIssue(hit.openId,hit.kind==="task_comment"?hit.id:undefined);
                          close();
                        }}
                      >
                        <Icon size={13} className="shrink-0 text-faint" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            {hit.ref && (
                              <span className="max-w-[124px] shrink-0 truncate font-mono text-small text-faint">
                                {hit.ref}
                              </span>
                            )}
                            <span className="min-w-0 flex-1 truncate">{hit.title || t("Untitled")}</span>
                          </span>
                          {hit.snippet && (
                            <span className="block truncate text-small text-faint">{hit.snippet}</span>
                          )}
                        </span>
                        <span suppressHydrationWarning className="shrink-0 text-caption text-faint">
                          {timeAgo(hit.updatedAt, locale)}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                );
              })}

            <Command.Group heading={t("Actions")}>
              <Command.Item
                value="new task create"
                onSelect={() => {
                  setComposerOpen(true);
                  close();
                }}
              >
                <span className="text-accent">+</span> {t("New task")}
              </Command.Item>
              {focused &&
                STATUS_ORDER.map((status) => (
                  <Command.Item
                    key={status}
                    value={`move ${focused.ref} ${t(STATUS_META[status].label)}`}
                    onSelect={() => {
                      void updateIssueAction(workspaceId, focused.id, { status }).then((result) => {
                        if (result.ok) { close(); router.refresh(); } else setError(result.error);
                      });
                    }}
                  >
                    <StatusIcon status={status} size={13} />
                    {t("Move {ref} to {status}", { ref: focused.ref, status: t(STATUS_META[status].label) })}
                  </Command.Item>
                ))}
              {focused && (
                <Command.Item
                  value="copy identifier"
                  onSelect={() => {
                    void navigator.clipboard.writeText(focused.ref);
                    close();
                  }}
                >
                  <span className="text-muted">⧉</span> {t("Copy identifier ({ref})", { ref: focused.ref })}
                </Command.Item>
              )}
            </Command.Group>

            <Command.Group heading={t("Navigation")}>
              <Command.Item
                value="all issues"
                onSelect={() => {
                  router.push(`/${workspaceId}`);
                  close();
                }}
              >
                {t("Go to All Tasks")}
              </Command.Item>
              <Command.Item
                value="my issues"
                onSelect={() => {
                  router.push(`/${workspaceId}?assignee=me`);
                  close();
                }}
              >
                {t("Go to My Tasks")}
              </Command.Item>
              <Command.Item
                value="notifications inbox"
                onSelect={() => {
                  router.push(`/${workspaceId}/notifications`);
                  close();
                }}
              >
                {t("Go to Inbox")}
              </Command.Item>
              <Command.Item
                value="labels"
                onSelect={() => {
                  router.push(`/${workspaceId}/settings#labels`);
                  close();
                }}
              >
                {t("Go to Labels")}
              </Command.Item>
              <Command.Item
                value="settings api keys agent members projects"
                onSelect={() => {
                  router.push(`/${workspaceId}/settings`);
                  close();
                }}
              >
                {t("Go to Settings")}
              </Command.Item>
            </Command.Group>
          </Command.List>
          <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-caption text-faint">
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
