"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PanelLeftClose } from "lucide-react";
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
  const [width, setWidth] = useStoredJson(`tacos.agent.sidebar.${scope}`, 232),
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
  const [changed,setChanged]=useState<Record<string,AgentThread|null>>({});
  // eslint-disable-next-line react-hooks/set-state-in-effect -- server updates replace older local edits
  useEffect(()=>{setChanged(old=>{const next={...old};for(const thread of threads){const local=next[thread.id];if(local && (thread.updatedAt>local.updatedAt || JSON.stringify(local)===JSON.stringify(thread)))delete next[thread.id];}return Object.keys(next).length===Object.keys(old).length?old:next;});},[threads]);
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
    const refresh=(event:Event)=>{
      const detail=(event as CustomEvent<{id:string;thread?:AgentThread|null}>).detail;
      if(!detail?.id)return;
      if("thread" in detail){
        setChanged(old=>({...old,[detail.id]:detail.thread??null}));
        setResult(old=>old?{...old,items:old.items.flatMap(thread=>thread.id!==detail.id?[thread]:detail.thread?[detail.thread]:[])}:old);
      } else setAttempt(old=>old+1);
    };
    window.addEventListener("tacos:thread-changed",refresh);
    return()=>window.removeEventListener("tacos:thread-changed",refresh);
  },[]);
  const all = [
    ...new Map(
      [...older, ...threads, ...Object.values(changed).filter((thread):thread is AgentThread=>Boolean(thread))].filter(thread=>changed[thread.id]!==null).map((thread) => [thread.id, thread]),
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
        className={`flex items-center gap-1.5 rounded px-2 py-1.5 text-body ${thread.id === activeId ? "bg-elevated font-medium" : "text-muted"}`}
      >
        {thread.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
        <span className="min-w-0 flex-1 truncate">{thread.title || t("New conversation")}</span>
        {thread.projectName && <span className="max-w-[40%] shrink-0 truncate text-caption font-normal text-faint">{thread.projectName}</span>}
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
      <div className="flex items-center gap-1.5 p-2">
        <Link
          data-testid="agent-new-chat"
          href={`/${workspaceId}/agent`}
          onClick={onNavigate}
          className="flex h-[30px] min-w-0 flex-1 items-center justify-center rounded-md border border-border bg-bg text-small font-medium text-text transition-colors hover:bg-elevated"
        >
          {t("New conversation")}
        </Link>
        <button
          type="button"
          onClick={onCollapse ?? onNavigate}
          aria-label={t("Collapse conversations")}
          title={t("Collapse conversations")}
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-text"
        >
          <PanelLeftClose size={15} />
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
        className="h-[34px] rounded-lg px-2.5 mx-2 mb-1 border border-border-strong bg-bg placeholder:text-faint text-body"
      />
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
                <h4 className="px-2 pb-1 pt-3 text-caption font-medium text-faint">{t("Pinned")}</h4>
                {pinned.map(row)}
              </>
            )}
            {(["shared", "private"] as const).map((visibility) => {
              const items = all.filter(
                (thread) => thread.visibility === visibility && !thread.pinnedAt,
              );
              return items.length ? (
                <div key={visibility}>
                  <h4 className="px-2 pb-1 pt-3 text-caption font-medium text-faint">
                    {t(visibility === "shared" ? "Shared conversations" : "Private conversations")}
                  </h4>
                  {items.map(row)}
                </div>
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
          onDoubleClick={() => setWidth(232)}
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
