"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ThreadMenu } from "@/components/thread-menu";
import { useUI } from "@/components/ui-context";
import { useT } from "@/components/i18n-context";
import { useStoredJson } from "@/lib/use-stored-json";
import {
  searchAgentThreadsAction,
  setAgentThreadUnreadAction,
} from "@/app/agent-actions";
import type { AgentThread } from "@/lib/agent-threads";
export function ThreadSidebar({
  workspaceId,
  threads,
  projects,
  activeId,
  variant = "docked",
  onNavigate,
  onCollapse,
}: {
  workspaceId: string;
  threads: AgentThread[];
  projects: { id: string; name: string }[];
  activeId?: string;
  variant?: "docked" | "drawer";
  onNavigate?: () => void;
  onCollapse?: () => void;
}) {
  const t = useT(),
    router = useRouter(),
    { scope, toast } = useUI();
  const [width, setWidth] = useStoredJson(`tacos.agent.sidebar.${scope}`, 248),
    [query, setQuery] = useState(""),
    [older, setOlder] = useState<AgentThread[]>([]),
    [historyOffset, setHistoryOffset] = useState<number | null>(0),
    [result, setResult] = useState<{
      query: string;
      items: AgentThread[];
      nextOffset: number | null;
    } | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const sequence = useRef(0),
    running = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const retry=useRef<()=>void>(()=>{});
  useEffect(() => {
    const seq = ++sequence.current;
    if (!query) return;
    const timer = setTimeout(() => {
      void searchAgentThreadsAction(workspaceId, query)
        .then((response) => {
          if (sequence.current !== seq) return;
          if (response.ok) {
            setResult({
              query,
              items: response.data.threads,
              nextOffset: response.data.nextOffset,
            });
            setError(null);
          } else {retry.current=()=>setAttempt(old=>old+1);setError(response.error);}
        })
        .catch(() => {
          if (sequence.current === seq){retry.current=()=>setAttempt(old=>old+1);setError("Could not search conversations. Retry.");}
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      sequence.current++;
    };
  }, [workspaceId, query, attempt]);
  async function more() {
    if (running.current) return;
    const offset = query ? result?.nextOffset : historyOffset;
    if (offset === null || offset === undefined) return;
    const seq = sequence.current;
    running.current = true;
    setBusy(true);
    try {
      const response = await searchAgentThreadsAction(
        workspaceId,
        query,
        offset,
      );
      if (seq !== sequence.current) return;
      if (!response.ok) {
        retry.current=()=>void more();setError(response.error);
        return;
      }
      if (query)
        setResult((old) => ({
          query,
          items: [
            ...new Map(
              [...(old?.items ?? []), ...response.data.threads].map(
                (thread) => [thread.id, thread],
              ),
            ).values(),
          ],
          nextOffset: response.data.nextOffset,
        }));
      else {
        setOlder((old) => [...old, ...response.data.threads]);
        setHistoryOffset(response.data.nextOffset);
      }
      setError(null);
    } catch {
      retry.current=()=>void more();setError("Could not search conversations. Retry.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    let live = true;
    const refresh = () => {
      setAttempt(old=>old+1);
      const pages = Math.max(
        1,
        Math.ceil((historyOffset ?? older.length) / 40),
      );
      void (async () => {
        const items: AgentThread[] = [];
        let offset: number | null = 0;
        for (let page = 0; page < pages && offset !== null; page++) {
          const result = await searchAgentThreadsAction(
            workspaceId,
            "",
            offset,
          );
          if (!result.ok) throw new Error(result.error);
          items.push(...result.data.threads);
          offset = result.data.nextOffset;
        }
        if (live) {
          setOlder(items);
          setHistoryOffset(offset);
        }
      })().catch(() => {
        if (live){retry.current=refresh;setError("Could not load conversations. Retry.");}
      });
    };
    window.addEventListener("tacos:thread-changed", refresh);
    return () => {
      live = false;
      window.removeEventListener("tacos:thread-changed", refresh);
    };
  }, [workspaceId, historyOffset, older.length]);
  const all = [
    ...new Map(
      [...older, ...threads].map((thread) => [thread.id, thread]),
    ).values(),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const pinned = all
    .filter((thread) => thread.pinnedAt)
    .sort((a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? ""));
  const row = (thread: AgentThread) => (
    <ThreadMenu
      key={thread.id}
      workspaceId={workspaceId}
      thread={thread}
      projects={projects}
    >
      <Link
        href={`/${workspaceId}/agent?thread=${thread.id}`}
        aria-current={thread.id === activeId ? "page" : undefined}
        onClick={() => {
          if (thread.unread)
            void setAgentThreadUnreadAction(workspaceId, thread.id, false).then(
              (response) => {
                if (!response.ok) toast(t(response.error));
                else router.refresh();
              },
            );
          onNavigate?.();
        }}
        className={`block truncate rounded px-2 py-1.5 text-body ${thread.id === activeId ? "bg-elevated font-medium" : "text-muted"}`}
      >
        {thread.unread ? "● " : ""}
        {thread.title || t("New conversation")}
      </Link>
    </ThreadMenu>
  );
  return (
    <aside
      style={{
        width: variant === "drawer" ? 264 : Math.max(200, Math.min(480, width)),
      }}
      className={`relative h-full shrink-0 flex-col border-r border-border bg-surface ${variant === "drawer" ? "flex" : "hidden @[620px]:flex"}`}
    >
      <div className="flex items-center gap-2 p-3 text-body">
        <strong className="flex-1">{t("Conversations")}</strong>
        <button
          onClick={onCollapse ?? onNavigate}
          aria-label={t("Collapse conversations")}
        >
          ←
        </button>
      </div>
      <input
        aria-label={t("Search conversations")}
        placeholder={t("Search titles and messages")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setError(null);
        }}
        className="mx-2 mb-2 rounded border border-border bg-bg px-2 py-1 text-small"
      />
      <Link data-testid="agent-new-chat"
        href={`/${workspaceId}/agent`}
        onClick={onNavigate}
        className="px-4 py-2 text-body"
      >
        ＋ {t("New chat")}
      </Link>
      <nav className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {error && (
          <p role="alert" className="text-small text-danger">
            {t(error)}
            <button
              onClick={() => {
                retry.current();
              }}
            >
              {t("Retry")}
            </button>
          </p>
        )}
        {query ? (
          <>
            {result?.query !== query && !error ? (
              <p className="text-small">{t("Loading…")}</p>
            ) : result?.query === query && result.items.length === 0 ? (
              <p className="text-small">{t("No matches.")}</p>
            ) : (
              result?.query === query && result.items.map(row)
            )}
            {result?.query === query && result.nextOffset !== null && (
              <button
                disabled={busy}
                onClick={() => void more()}
                className="p-2 text-small"
              >
                {t("Load more")}
              </button>
            )}
          </>
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                <p className="px-2 pt-2 text-small text-faint">{t("Pinned")}</p>
                {pinned.map(row)}
              </>
            )}
            {[
              ...projects,
              ...[...new Set(all.map((thread) => thread.projectId))]
                .filter(
                  (id) => id && !projects.some((project) => project.id === id),
                )
                .map((id) => ({
                  id,
                  name:
                    all.find((thread) => thread.projectId === id)
                      ?.projectName || t("Project"),
                })),
              { id: "", name: t("No project") },
            ].map((project) => {
              const items = all.filter(
                (thread) => thread.projectId === project.id && !thread.pinnedAt,
              );
              return items.length ? (
                <details open key={project.id}>
                  <summary className="cursor-pointer px-2 py-2 text-small text-faint">
                    {project.name}
                  </summary>
                  {items.map(row)}
                </details>
              ) : null;
            })}
            {historyOffset !== null && (
              <button
                disabled={busy}
                onClick={() => void more()}
                className="p-2 text-small"
              >
                {t("Load older conversations")}
              </button>
            )}
          </>
        )}
      </nav>
      {variant === "docked" && (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-valuenow={width}
          aria-label={t("Resize conversations")}
          className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none hover:bg-accent/20"
          onDoubleClick={() => setWidth(248)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              setWidth(
                Math.max(
                  200,
                  Math.min(480, width + (e.key === "ArrowRight" ? 10 : -10)),
                ),
              );
            }
          }}
          onPointerDown={(e) => {
            const start = e.clientX,
              initial = width,
              target = e.currentTarget;
            target.setPointerCapture(e.pointerId);
            const move = (event: PointerEvent) =>
              setWidth(
                Math.max(200, Math.min(480, initial + event.clientX - start)),
              );
            const end = () => {
              target.removeEventListener("pointermove", move);
              target.removeEventListener("pointerup", end);
              target.removeEventListener("pointercancel", end);
            };
            target.addEventListener("pointermove", move);
            target.addEventListener("pointerup", end);
            target.addEventListener("pointercancel", end);
          }}
        />
      )}
    </aside>
  );
}
